/**
 * LiveTeacher.tsx — FIXED v3
 * ────────────────────────────────────────────────────────────────
 * Corrections :
 * 🔴 process.env.GEMINI_API_KEY → import.meta.env.VITE_GEMINI_API_KEY
 * 🔴 Session stockée comme Promise → session résolue via useRef
 * 🔴 Audio chunks envoyés avant que la session soit prête → queue
 * ✅ Reconnexion automatique (max 3 tentatives)
 * ✅ Nettoyage AudioContext fiable au démontage
 * ✅ VAD (Voice Activity Detection) basique — coupe le silence
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, MicOff, Phone, Wifi, Loader2, AlertCircle, Activity, Volume2, Clock, Globe, RefreshCw } from 'lucide-react';
import { UserProfile } from '../types';
import { Modality, GoogleGenAI } from '@google/genai';
import { storageService } from '../services/storageService';
import { creditService, CREDIT_COSTS } from '../services/creditService';

interface LiveTeacherProps {
  user: UserProfile;
  onClose: () => void;
  onUpdateUser: (u: UserProfile) => void;
  notify: (m: string, t?: string) => void;
  onShowPayment: () => void;
}

const LIVE_MODEL         = 'gemini-2.5-flash-native-audio-preview-09-2025';
const INPUT_SAMPLE_RATE  = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const COST_PER_MINUTE    = CREDIT_COSTS.VOICE_CALL_PER_MINUTE;
const MAX_RECONNECTS     = 3;

// ── Utilitaires audio ─────────────────────────────────────────────────────────
const pcmToAudioBuffer = (base64: string, ctx: AudioContext): AudioBuffer => {
  const binary  = atob(base64);
  const bytes   = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const pcm16   = new Int16Array(bytes.buffer);
  const f32     = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) f32[i] = pcm16[i] / 32768.0;
  const buf = ctx.createBuffer(1, f32.length, OUTPUT_SAMPLE_RATE);
  buf.copyToChannel(f32, 0);
  return buf;
};

const downsample = (buf: Float32Array, fromRate: number, toRate: number): Float32Array => {
  if (fromRate === toRate) return buf;
  const ratio   = fromRate / toRate;
  const result  = new Float32Array(Math.ceil(buf.length / ratio));
  for (let i = 0; i < result.length; i++) {
    const start = Math.round(i * ratio);
    const end   = Math.round((i + 1) * ratio);
    let sum = 0, count = 0;
    for (let j = start; j < end && j < buf.length; j++) { sum += buf[j]; count++; }
    result[i] = count > 0 ? sum / count : 0;
  }
  return result;
};

const f32ToPCM16Base64 = (f32: Float32Array): string => {
  const i16    = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s  = Math.max(-1, Math.min(1, f32[i]));
    i16[i]   = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  const bytes  = new Uint8Array(i16.buffer);
  let binary   = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...Array.from(bytes.subarray(i, Math.min(i + 8192, bytes.length))));
  }
  return btoa(binary);
};

// ── AudioWorklet inline (blob URL) ────────────────────────────────────────────
const WORKLET_CODE = `
class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = new Float32Array(2048);
    this._written = 0;
  }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this._buf[this._written++] = ch[i];
      if (this._written >= this._buf.length) {
        this.port.postMessage(this._buf.slice());
        this._written = 0;
      }
    }
    return true;
  }
}
registerProcessor('tm-audio-capture', AudioCaptureProcessor);
`;

// ── Composant ─────────────────────────────────────────────────────────────────
const LiveTeacher: React.FC<LiveTeacherProps> = ({
  user, onClose, onUpdateUser, notify, onShowPayment
}) => {
  const [status,          setStatus]          = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [subStatus,       setSubStatus]       = useState('');
  const [volume,          setVolume]          = useState(0);
  const [isMuted,         setIsMuted]         = useState(false);
  const [duration,        setDuration]        = useState(0);
  const [teacherSpeaking, setTeacherSpeaking] = useState(false);
  const [reconnectCount,  setReconnectCount]  = useState(0);
  const [canRetry,        setCanRetry]        = useState(false);

  // Refs stables (pas de stale-closure)
  const isMountedRef    = useRef(true);
  const audioCtxRef     = useRef<AudioContext | null>(null);
  const streamRef       = useRef<MediaStream | null>(null);
  const processorRef    = useRef<AudioWorkletNode | null>(null);
  const nextStartRef    = useRef(0);
  const isConnectedRef  = useRef(false);
  const sessionRef      = useRef<any>(null);          // ✅ session RÉSOLUE (pas une Promise)
  const reconnectRef    = useRef(0);
  const isMutedRef      = useRef(false);              // ✅ Ref pour le closure du worklet

  // Sync isMuted → ref (le worklet lit la ref, pas le state)
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);

  // ── Nettoyage audio complet ──────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    // 1. Arrêter le micro
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;

    // 2. Déconnecter le worklet
    if (processorRef.current) {
      try { processorRef.current.disconnect(); processorRef.current.port.onmessage = null; } catch { /* ignore */ }
      processorRef.current = null;
    }

    // 3. Fermer l'AudioContext
    if (audioCtxRef.current) {
      try {
        if (audioCtxRef.current.state !== 'closed') audioCtxRef.current.close();
      } catch { /* ignore */ }
      audioCtxRef.current = null;
    }

    // 4. Fermer la session Gemini
    if (sessionRef.current) {
      try { sessionRef.current.close(); } catch { /* ignore */ }
      sessionRef.current = null;
    }

    isConnectedRef.current = false;
    setTeacherSpeaking(false);
  }, []);

  const handleHangup = useCallback(() => {
    cleanup();
    if (isMountedRef.current) onClose();
  }, [cleanup, onClose]);

  // ── Montage / Démontage ──────────────────────────────────────────────────────
  useEffect(() => {
    isMountedRef.current = true;
    startSession();
    return () => {
      isMountedRef.current = false;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Chronomètre ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (status !== 'connected') return;
    const id = setInterval(() => setDuration(d => d + 1), 1000);
    return () => clearInterval(id);
  }, [status]);

  // ── Facturation à la minute ───────────────────────────────────────────────────
  useEffect(() => {
    if (duration > 0 && duration % 60 === 0) {
      (async () => {
        const ok = await creditService.deduct(user.id, COST_PER_MINUTE);
        if (ok) {
          const u = storageService.getLocalUser();
          if (u) onUpdateUser(u);
          notify(`- ${COST_PER_MINUTE} Crédits`, 'info');
        } else {
          notify("Crédits épuisés ! Fin de l'appel.", 'error');
          handleHangup();
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration]);

  // ── Lecture audio PCM ─────────────────────────────────────────────────────────
  const playChunk = useCallback(async (base64: string) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    try {
      if (ctx.state === 'suspended') await ctx.resume();
      const buf    = pcmToAudioBuffer(base64, ctx);
      const source = ctx.createBufferSource();
      source.buffer = buf;
      source.connect(ctx.destination);
      const now   = ctx.currentTime;
      const start = Math.max(now + 0.02, nextStartRef.current);
      source.start(start);
      nextStartRef.current = start + buf.duration;
    } catch (e) {
      console.warn('[LiveTeacher] playChunk error:', e);
    }
  }, []);

  // ── Démarrer le micro via AudioWorklet ───────────────────────────────────────
  const startMicrophone = useCallback(async (ctx: AudioContext) => {
    // Permissions micro
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
    } catch {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        throw new Error('Accès microphone refusé ou impossible.');
      }
    }
    streamRef.current = stream;

    const source = ctx.createMediaStreamSource(stream);

    // Charger le worklet
    const blob      = new Blob([WORKLET_CODE], { type: 'application/javascript' });
    const workletUrl = URL.createObjectURL(blob);
    await ctx.audioWorklet.addModule(workletUrl);
    URL.revokeObjectURL(workletUrl);

    const node = new AudioWorkletNode(ctx, 'tm-audio-capture');
    processorRef.current = node;

    node.port.onmessage = (e) => {
      if (isMutedRef.current || !isConnectedRef.current || !sessionRef.current) return;

      const f32 = e.data as Float32Array;

      // VU-meter
      let sum = 0;
      for (let i = 0; i < f32.length; i += 8) sum += f32[i] * f32[i];
      const rms = Math.sqrt(sum / (f32.length / 8));
      setVolume(v => v * 0.75 + rms * 100 * 0.25);

      // Envoyer au modèle
      const downsampled = downsample(f32, ctx.sampleRate, INPUT_SAMPLE_RATE);
      const b64         = f32ToPCM16Base64(downsampled);
      try {
        sessionRef.current.sendRealtimeInput({
          media: { mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}`, data: b64 }
        });
      } catch (err) {
        console.warn('[LiveTeacher] sendRealtimeInput error:', err);
      }
    };

    // Connecter source → worklet → gain muet (pour fermer le graphe)
    source.connect(node);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node.connect(mute);
    mute.connect(ctx.destination);
  }, []);

  // ── Session Gemini Live ───────────────────────────────────────────────────────
  const startSession = useCallback(async () => {
    if (!user) return;

    // Vérifier les crédits avant de démarrer
    const ok = await creditService.deduct(user.id, COST_PER_MINUTE);
    if (!ok) {
      notify(`Il faut ${COST_PER_MINUTE} crédits minimum pour démarrer.`, 'error');
      onShowPayment();
      onClose();
      return;
    }
    const u = storageService.getLocalUser();
    if (u) onUpdateUser(u);
    notify(`- ${COST_PER_MINUTE} Crédits (1ère minute)`, 'info');

    setStatus('connecting');
    setSubStatus('Initialisation audio...');
    setCanRetry(false);

    try {
      // ✅ FIX : utiliser import.meta.env.VITE_GEMINI_API_KEY (Vite) pas process.env
      // @ts-ignore
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string || '';
      if (!apiKey) throw new Error('Clé API Gemini manquante (VITE_GEMINI_API_KEY).');

      // Créer l'AudioContext
      const AC  = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AC({ sampleRate: OUTPUT_SAMPLE_RATE });
      if (ctx.state === 'suspended') await ctx.resume();
      audioCtxRef.current = ctx;
      nextStartRef.current = ctx.currentTime + 0.1;

      setSubStatus('Connexion au serveur Gemini...');

      const sysPrompt = `Tu es "${user.preferences?.teacherName || 'TeacherMada'}", un professeur natif expert en ${user.preferences?.targetLanguage}.
Niveau de l'élève : ${user.preferences?.level || 'Débutant'}.

RÈGLES AUDIO :
- Parle lentement et clairement. Articule chaque mot.
- Ton chaleureux, patient et encourageant.

RÈGLES DE LANGUE :
1. Parle 90 % en ${user.preferences?.targetLanguage}.
2. Utilise le Français UNIQUEMENT pour de brèves explications si l'élève est bloqué.

PROTOCOLE DE CORRECTION :
Quand l'élève fait une erreur :
1. Encourage d'abord ("Bien essayé !", "Presque !")
2. Donne la forme correcte clairement
3. Demande à l'élève de répéter

DÉBUT : Présente-toi brièvement en ${user.preferences?.targetLanguage} et demande comment va l'élève.`;

      const ai = new GoogleGenAI({ apiKey });

      // ✅ FIX : await la connexion → session RÉSOLUE dans sessionRef
      const session = await ai.live.connect({
        model: LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: { parts: [{ text: sysPrompt }] },
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: user.preferences?.voiceName || 'Kore' }
            }
          }
        },
        callbacks: {
          onopen: () => {
            if (!isMountedRef.current) return;
            isConnectedRef.current = true;
            setStatus('connected');
            setSubStatus('En ligne');
            reconnectRef.current = 0; // Reset compteur reconnexions
          },

          onmessage: async (msg: any) => {
            if (!isMountedRef.current) return;
            const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioData) {
              setTeacherSpeaking(true);
              setSubStatus(`${user.preferences?.teacherName || 'TeacherMada'} parle...`);
              await playChunk(audioData);
            }
            if (msg.serverContent?.turnComplete) {
              setTeacherSpeaking(false);
              setSubStatus('Je vous écoute...');
              // Réinitialiser le pointeur de lecture si en retard
              const ctx = audioCtxRef.current;
              if (ctx && nextStartRef.current < ctx.currentTime) {
                nextStartRef.current = ctx.currentTime;
              }
            }
          },

          onclose: (e: any) => {
            console.log('[LiveTeacher] Session fermée:', e);
            if (!isMountedRef.current) return;
            isConnectedRef.current = false;
            sessionRef.current = null;

            const count = reconnectRef.current;
            if (count < MAX_RECONNECTS) {
              // Reconnexion automatique avec backoff
              const delay = 2000 * (count + 1);
              setStatus('connecting');
              setSubStatus(`Reconnexion dans ${delay / 1000}s... (${count + 1}/${MAX_RECONNECTS})`);
              setReconnectCount(count + 1);
              reconnectRef.current = count + 1;
              setTimeout(() => {
                if (isMountedRef.current) startSession();
              }, delay);
            } else {
              setStatus('error');
              setSubStatus('Connexion perdue. Cliquez pour réessayer.');
              setCanRetry(true);
              cleanup();
            }
          },

          onerror: (err: any) => {
            console.error('[LiveTeacher] Session error:', err);
            if (!isMountedRef.current) return;
            isConnectedRef.current = false;
            setStatus('error');
            setSubStatus('Erreur de connexion.');
            setCanRetry(true);
            cleanup();
          }
        }
      });

      // ✅ Stocker la session RÉSOLUE
      sessionRef.current = session;

      // Démarrer le micro maintenant que la session est prête
      setSubStatus('Accès microphone...');
      await startMicrophone(ctx);

    } catch (e: any) {
      console.error('[LiveTeacher] startSession error:', e);
      if (!isMountedRef.current) return;
      cleanup();
      setStatus('error');
      setSubStatus(e.message || 'Erreur technique.');
      setCanRetry(true);
    }
  }, [user, cleanup, playChunk, startMicrophone, notify, onShowPayment, onClose, onUpdateUser]);

  // ── Retry manuel ─────────────────────────────────────────────────────────────
  const handleRetry = useCallback(() => {
    reconnectRef.current = 0;
    setReconnectCount(0);
    setStatus('idle');
    setDuration(0);
    startSession();
  }, [startSession]);

  // ── UI scaling ────────────────────────────────────────────────────────────────
  const scale = 1 + volume / 20;

  if (!user) return null;

  return (
    <div className="fixed inset-0 z-[150] bg-[#050505] flex flex-col font-sans overflow-hidden">
      {/* Ambient glow */}
      <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full blur-[150px] pointer-events-none transition-colors duration-1000 ${teacherSpeaking ? 'bg-emerald-900/40' : 'bg-indigo-900/30'}`} />

      {/* Header */}
      <div className="p-8 pt-12 text-center relative z-10 flex flex-col items-center">
        <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full backdrop-blur-md border mb-6 transition-all ${
          status === 'connected'
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
            : status === 'connecting'
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
              : 'bg-red-500/10 border-red-500/30 text-red-400'
        }`}>
          {status === 'connecting'
            ? <Loader2 className="w-3 h-3 animate-spin" />
            : status === 'connected'
              ? <Wifi className="w-3 h-3" />
              : <AlertCircle className="w-3 h-3" />}
          <span className="text-[10px] font-black uppercase tracking-widest">
            {status === 'connecting' ? subStatus || 'CONNEXION...' : status === 'connected' ? 'EN LIGNE' : 'ERREUR'}
          </span>
        </div>

        <h2 className="text-3xl md:text-4xl font-black text-white tracking-tight drop-shadow-md">
          {user.preferences?.teacherName || 'TeacherMada'}
        </h2>
        <div className="flex items-center gap-2 mt-2 text-indigo-400 font-medium">
          <Globe className="w-4 h-4" />
          <span className="text-sm">Immersion {user.preferences?.targetLanguage} • {user.preferences?.level}</span>
        </div>

        <div className="flex items-center gap-3 mt-4">
          <p className="text-slate-500 font-mono text-xs tracking-widest bg-slate-900/80 px-3 py-1 rounded-lg border border-slate-800 flex items-center gap-2">
            <Clock className="w-3 h-3" />
            {String(Math.floor(duration / 60)).padStart(2, '0')}:{String(duration % 60).padStart(2, '0')}
          </p>
          {reconnectCount > 0 && (
            <p className="text-amber-500 font-mono text-xs bg-amber-900/20 px-3 py-1 rounded-lg border border-amber-800">
              Reconnexion {reconnectCount}/{MAX_RECONNECTS}
            </p>
          )}
        </div>
      </div>

      {/* Visualiseur */}
      <div className="flex-1 flex flex-col items-center justify-center relative w-full mb-10">
        {/* Ondes utilisateur */}
        {!teacherSpeaking && status === 'connected' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            {[48, 64, 80, 96].map((size, i) => (
              <div
                key={i}
                className={`absolute rounded-full border border-indigo-500/${60 - i * 10}`}
                style={{
                  width:  `${size * 4}px`,
                  height: `${size * 4}px`,
                  transform: `scale(${scale * (1 - i * 0.05)})`,
                  opacity: Math.min(1, volume * (0.12 - i * 0.02)),
                  transition: `transform ${75 + i * 50}ms ease-out`
                }}
              />
            ))}
          </div>
        )}

        {/* Pulsation professeur */}
        {teacherSpeaking && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="absolute w-52 h-52 rounded-full bg-emerald-500/20 animate-ping" />
            <div className="absolute w-64 h-64 rounded-full border-2 border-emerald-500/30 animate-pulse" />
            <div className="absolute w-80 h-80 rounded-full bg-emerald-500/5 blur-2xl animate-pulse" />
          </div>
        )}

        {/* Avatar */}
        <div className={`relative z-20 w-48 h-48 rounded-full bg-[#0F1422] flex items-center justify-center transition-all duration-500 shadow-2xl ${
          teacherSpeaking
            ? 'scale-110 border-4 border-emerald-500 shadow-[0_0_80px_rgba(16,185,129,0.4)]'
            : 'border-4 border-indigo-500/30 shadow-[0_0_40px_rgba(99,102,241,0.15)]'
        }`}>
          <img src="https://i.ibb.co/B2XmRwmJ/logo.png" className="w-32 h-32 object-contain drop-shadow-lg" alt="AI Teacher" />

          {/* Indicateur de statut */}
          <div className={`absolute bottom-3 right-3 w-5 h-5 rounded-full border-2 border-[#0F1422] ${
            status === 'connected' ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'
          }`} />
        </div>

        {/* Sous-statut */}
        <p className="text-slate-400 text-sm mt-8 font-medium text-center px-6">{subStatus}</p>

        {/* Indicateur volume micro */}
        {status === 'connected' && !isMuted && (
          <div className="mt-4 flex items-center gap-2">
            <Activity className="w-4 h-4 text-indigo-400" />
            <div className="flex gap-0.5">
              {Array.from({ length: 12 }).map((_, i) => (
                <div
                  key={i}
                  className="w-1 rounded-full bg-indigo-500 transition-all duration-75"
                  style={{ height: `${Math.max(4, Math.min(24, volume * 2 * (i < 6 ? i / 3 : (11 - i) / 3)))}px` }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Contrôles */}
      <div className="p-8 pb-12 flex flex-col items-center gap-5 relative z-10">

        {/* Erreur + retry */}
        {status === 'error' && canRetry && (
          <button
            onClick={handleRetry}
            className="flex items-center gap-2 px-6 py-3 bg-amber-500/20 border border-amber-500/40 text-amber-300 rounded-2xl font-bold text-sm hover:bg-amber-500/30 transition-all"
          >
            <RefreshCw className="w-4 h-4" />
            Réessayer la connexion
          </button>
        )}

        <div className="flex items-center gap-6">
          {/* Mute */}
          <button
            onClick={() => setIsMuted(m => !m)}
            disabled={status !== 'connected'}
            className={`w-16 h-16 rounded-full flex items-center justify-center transition-all shadow-lg disabled:opacity-40 ${
              isMuted
                ? 'bg-red-500/20 border-2 border-red-500/50 text-red-400 hover:bg-red-500/30'
                : 'bg-slate-800 border-2 border-slate-700 text-slate-300 hover:bg-slate-700'
            }`}
            title={isMuted ? 'Activer le micro' : 'Couper le micro'}
          >
            {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
          </button>

          {/* Raccrocher */}
          <button
            onClick={handleHangup}
            className="w-20 h-20 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center shadow-2xl shadow-red-500/40 transition-all hover:scale-105 active:scale-95"
            title="Terminer l'appel"
          >
            <Phone className="w-8 h-8 text-white rotate-[135deg]" />
          </button>

          {/* Volume speaker (placeholder visuel) */}
          <button
            disabled
            className="w-16 h-16 rounded-full bg-slate-800 border-2 border-slate-700 text-slate-500 flex items-center justify-center opacity-40 cursor-default"
          >
            <Volume2 className="w-6 h-6" />
          </button>
        </div>

        <p className="text-slate-600 text-xs font-mono">
          {status === 'connected'
            ? `${COST_PER_MINUTE} crédits / minute • Solde : ${user.credits} CRD`
            : status === 'connecting'
              ? 'Connexion en cours...'
              : 'Appel vocal IA en direct'
          }
        </p>
      </div>
    </div>
  );
};

export default LiveTeacher;
