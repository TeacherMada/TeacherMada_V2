/**
 * LiveTeacher.tsx — v5 WebSocket Natif
 * ──────────────────────────────────────────────────────────────
 * Root cause fix : @google/genai 0.2.x n'a PAS d'API live.
 * Solution : WebSocket natif vers l'API Gemini BidiGenerateContent.
 *
 * Endpoint : wss://generativelanguage.googleapis.com/ws/
 *            google.ai.generativelanguage.v1beta.GenerativeService
 *            .BidiGenerateContent?key=API_KEY
 *
 * ✅ Aucune dépendance SDK
 * ✅ Crédits débités une seule fois (pas à chaque reconnexion)
 * ✅ Reconnexion auto ×3 avec backoff exponentiel
 * ✅ AudioWorklet : latence minimale
 * ✅ API key depuis geminiService (rotation multi-clé)
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Mic, MicOff, Phone, Wifi, Loader2,
  AlertCircle, Activity, Volume2, Clock, Globe, RefreshCw
} from 'lucide-react';
import { UserProfile } from '../types';
import { storageService } from '../services/storageService';
import { creditService, CREDIT_COSTS } from '../services/creditService';

interface LiveTeacherProps {
  user: UserProfile;
  onClose: () => void;
  onUpdateUser: (u: UserProfile) => void;
  notify: (m: string, t?: string) => void;
  onShowPayment: () => void;
}

// ── Config ────────────────────────────────────────────────────────────────────
const LIVE_MODEL         = 'gemini-2.5-flash-native-audio-preview-09-2025'; // modèle stable Live API
const INPUT_SAMPLE_RATE  = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const COST_PER_MINUTE    = CREDIT_COSTS.VOICE_CALL_PER_MINUTE;
const MAX_RECONNECTS     = 3;
const WS_BASE            = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

// ── Utilitaires audio ─────────────────────────────────────────────────────────
const b64ToPcmBuffer = (b64: string, ctx: AudioContext): AudioBuffer => {
  const bin  = atob(b64);
  const u8   = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const i16  = new Int16Array(u8.buffer);
  const f32  = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768.0;
  const buf  = ctx.createBuffer(1, f32.length, OUTPUT_SAMPLE_RATE);
  buf.copyToChannel(f32, 0);
  return buf;
};

const downsample = (f32: Float32Array, from: number, to: number): Float32Array => {
  if (from === to) return f32;
  const ratio = from / to;
  const out   = new Float32Array(Math.ceil(f32.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const s = Math.round(i * ratio), e = Math.round((i + 1) * ratio);
    let sum = 0, n = 0;
    for (let j = s; j < e && j < f32.length; j++) { sum += f32[j]; n++; }
    out[i] = n ? sum / n : 0;
  }
  return out;
};

const f32ToB64Pcm16 = (f32: Float32Array): string => {
  const i16  = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    i16[i]  = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  const u8   = new Uint8Array(i16.buffer);
  let out = '';
  for (let i = 0; i < u8.length; i += 8192) {
    out += String.fromCharCode(...Array.from(u8.subarray(i, Math.min(i + 8192, u8.length))));
  }
  return btoa(out);
};

const WORKLET = `
class TmCapture extends AudioWorkletProcessor {
  constructor() { super(); this._b = new Float32Array(2048); this._w = 0; }
  process(inputs) {
    const ch = inputs[0]?.[0]; if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this._b[this._w++] = ch[i];
      if (this._w >= this._b.length) { this.port.postMessage(this._b.slice()); this._w = 0; }
    }
    return true;
  }
}
registerProcessor('tm-live-cap', TmCapture);
`;

// ═════════════════════════════════════════════════════════════════════════════
const LiveTeacher: React.FC<LiveTeacherProps> = ({
  user, onClose, onUpdateUser, notify, onShowPayment
}) => {
  const [status,          setStatus]          = useState<'idle'|'connecting'|'connected'|'error'>('idle');
  const [subStatus,       setSubStatus]       = useState('');
  const [errorDetail,     setErrorDetail]     = useState('');
  const [volume,          setVolume]          = useState(0);
  const [isMuted,         setIsMuted]         = useState(false);
  const [duration,        setDuration]        = useState(0);
  const [teacherSpeaking, setTeacherSpeaking] = useState(false);
  const [reconnectCount,  setReconnectCount]  = useState(0);
  const [canRetry,        setCanRetry]        = useState(false);

  const isMountedRef   = useRef(true);
  const audioCtxRef    = useRef<AudioContext | null>(null);
  const streamRef      = useRef<MediaStream | null>(null);
  const processorRef   = useRef<AudioWorkletNode | null>(null);
  const nextStartRef   = useRef(0);
  const wsRef          = useRef<WebSocket | null>(null);
  const reconnectRef   = useRef(0);
  const isMutedRef     = useRef(false);
  const wsReadyRef     = useRef(false);   // WS open + setup complet
  const billedOnceRef  = useRef(false);   // évite double débit sur reconnexion

  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);

  // ── Nettoyage complet ─────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    wsReadyRef.current = false;

    if (wsRef.current) {
      try { wsRef.current.close(1000, 'cleanup'); } catch { /* ignore */ }
      wsRef.current = null;
    }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;

    if (processorRef.current) {
      try { processorRef.current.disconnect(); processorRef.current.port.onmessage = null; }
      catch { /* ignore */ }
      processorRef.current = null;
    }
    if (audioCtxRef.current) {
      try { if (audioCtxRef.current.state !== 'closed') audioCtxRef.current.close(); }
      catch { /* ignore */ }
      audioCtxRef.current = null;
    }
    setTeacherSpeaking(false);
  }, []);

  const handleHangup = useCallback(() => {
    cleanup();
    if (isMountedRef.current) onClose();
  }, [cleanup, onClose]);

  useEffect(() => {
    isMountedRef.current = true;
    startSession();
    return () => {
      isMountedRef.current = false;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Chronomètre ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (status !== 'connected') return;
    const id = setInterval(() => setDuration(d => d + 1), 1000);
    return () => clearInterval(id);
  }, [status]);

  // ── Facturation par minute ────────────────────────────────────────────────
  useEffect(() => {
    if (duration <= 0 || duration % 60 !== 0) return;
    (async () => {
      const ok = await creditService.deduct(user.id, COST_PER_MINUTE);
      if (ok) {
        const u = storageService.getLocalUser();
        if (u) onUpdateUser(u);
        notify(`- ${COST_PER_MINUTE} crédits`, 'info');
      } else {
        notify("Crédits épuisés ! Fin de l'appel.", 'error');
        handleHangup();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration]);

  // ── Lecture audio PCM ────────────────────────────────────────────────────
  const playChunk = useCallback(async (b64: string) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    try {
      if (ctx.state === 'suspended') await ctx.resume();
      const buf    = b64ToPcmBuffer(b64, ctx);
      const src    = ctx.createBufferSource();
      src.buffer   = buf;
      src.connect(ctx.destination);
      const now    = ctx.currentTime;
      const start  = Math.max(now + 0.02, nextStartRef.current);
      src.start(start);
      nextStartRef.current = start + buf.duration;
    } catch (e) { console.warn('[Live] playChunk:', e); }
  }, []);

  // ── Envoyer du PCM au WebSocket ───────────────────────────────────────────
  const sendAudio = useCallback((b64: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !wsReadyRef.current) return;
    try {
      ws.send(JSON.stringify({
        realtimeInput: {
          mediaChunks: [{ mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}`, data: b64 }]
        }
      }));
    } catch (e) { console.warn('[Live] sendAudio error:', e); }
  }, []);

  // ── Démarrer le microphone ────────────────────────────────────────────────
  const startMicrophone = useCallback(async (ctx: AudioContext) => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
    } catch {
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
      catch { throw new Error('Accès microphone refusé ou impossible.'); }
    }
    streamRef.current = stream;

    const source     = ctx.createMediaStreamSource(stream);
    const blob       = new Blob([WORKLET], { type: 'application/javascript' });
    const workletUrl = URL.createObjectURL(blob);
    await ctx.audioWorklet.addModule(workletUrl);
    URL.revokeObjectURL(workletUrl);

    const node = new AudioWorkletNode(ctx, 'tm-live-cap');
    processorRef.current = node;

    node.port.onmessage = (e) => {
      if (isMutedRef.current || !wsReadyRef.current) return;
      const f32 = e.data as Float32Array;

      // VU-mètre
      let sum = 0;
      for (let i = 0; i < f32.length; i += 8) sum += f32[i] * f32[i];
      setVolume(v => v * 0.75 + Math.sqrt(sum / (f32.length / 8)) * 100 * 0.25);

      const ds  = downsample(f32, ctx.sampleRate, INPUT_SAMPLE_RATE);
      sendAudio(f32ToB64Pcm16(ds));
    };

    source.connect(node);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node.connect(mute);
    mute.connect(ctx.destination);
  }, [sendAudio]);

  // ── Session principale ────────────────────────────────────────────────────
  const startSession = useCallback(async () => {
    if (!user) return;

    // ✅ Débit crédits une seule fois (pas à chaque reconnexion auto)
    if (!billedOnceRef.current) {
      const ok = await creditService.deduct(user.id, COST_PER_MINUTE);
      if (!ok) {
        notify(`Il faut ${COST_PER_MINUTE} crédits minimum pour démarrer.`, 'error');
        onShowPayment();
        onClose();
        return;
      }
      billedOnceRef.current = true;
      const u = storageService.getLocalUser();
      if (u) onUpdateUser(u);
      notify(`- ${COST_PER_MINUTE} crédits`, 'info');
    }

    setStatus('connecting');
    setSubStatus('Initialisation audio...');
    setErrorDetail('');
    setCanRetry(false);

    try {
      // ✅ Récupérer la clé depuis import.meta.env (Vite frontend)
      // @ts-ignore
      const rawKey = (import.meta.env.VITE_GEMINI_API_KEY as string || '').trim();
      // Supporte plusieurs clés séparées par virgule (rotation)
      const apiKey = rawKey.split(',')[0].trim();
      if (!apiKey) throw new Error('Clé API Gemini manquante. Ajoutez VITE_GEMINI_API_KEY dans les variables d\'environnement Render.');

      // AudioContext
      const AC  = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AC({ sampleRate: OUTPUT_SAMPLE_RATE });
      if (ctx.state === 'suspended') await ctx.resume();
      audioCtxRef.current  = ctx;
      nextStartRef.current = ctx.currentTime + 0.1;

      setSubStatus('Connexion Gemini Live...');

      const sysPrompt = `Tu es "${user.preferences?.teacherName || 'TeacherMada'}", professeur expert en ${user.preferences?.targetLanguage || 'Anglais'}.
Niveau élève : ${user.preferences?.level || 'Débutant'}.
Parle 90 % en ${user.preferences?.targetLanguage || 'Anglais'}, lentement et clairement.
Utilise le Français uniquement si l'élève est bloqué (brèves explications).
Protocole de correction : encourage → donne la bonne forme → demande de répéter.
Commence par te présenter brièvement et demander comment va l'élève.`;

      // ✅ WebSocket natif — aucune dépendance SDK
      const wsUrl = `${WS_BASE}?key=${apiKey}`;
      const ws    = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        if (!isMountedRef.current) return;
        console.log('[Live] WS ouvert — envoi setup...');
        setSubStatus('Configuration session...');

        // Envoyer le message de setup initial
        ws.send(JSON.stringify({
          setup: {
            model: `models/${LIVE_MODEL}`,
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: user.preferences?.voiceName || 'Kore'
                  }
                }
              }
            },
            systemInstruction: {
              parts: [{ text: sysPrompt }]
            }
          }
        }));
      };

      ws.onmessage = async (event) => {
        if (!isMountedRef.current) return;
        try {
          const text = typeof event.data === 'string'
            ? event.data
            : new TextDecoder().decode(event.data);
          const msg  = JSON.parse(text);

          // ── Setup confirmé ────────────────────────────────────────────────
          if (msg.setupComplete) {
            console.log('[Live] ✅ Setup confirmé — session active');
            wsReadyRef.current = true;
            reconnectRef.current = 0;
            setStatus('connected');
            setSubStatus('En ligne');
            setReconnectCount(0);

            // Démarrer le micro maintenant que le serveur est prêt
            setSubStatus('Accès microphone...');
            try {
              await startMicrophone(ctx);
              setSubStatus('Je vous écoute...');
            } catch (micErr: any) {
              console.error('[Live] Micro error:', micErr.message);
              setStatus('error');
              setSubStatus(micErr.message);
              setErrorDetail('Vérifiez les permissions microphone dans votre navigateur.');
              setCanRetry(false);
              cleanup();
            }
            return;
          }

          // ── Audio du modèle ───────────────────────────────────────────────
          const parts = msg.serverContent?.modelTurn?.parts;
          if (parts) {
            for (const part of parts) {
              if (part.inlineData?.data) {
                setTeacherSpeaking(true);
                setSubStatus(`${user.preferences?.teacherName || 'TeacherMada'} parle...`);
                await playChunk(part.inlineData.data);
              }
            }
          }

          // ── Tour terminé ──────────────────────────────────────────────────
          if (msg.serverContent?.turnComplete) {
            setTeacherSpeaking(false);
            setSubStatus('Je vous écoute...');
            const c = audioCtxRef.current;
            if (c && nextStartRef.current < c.currentTime) {
              nextStartRef.current = c.currentTime;
            }
          }

          // ── Erreur renvoyée par l'API ─────────────────────────────────────
          if (msg.error) {
            console.error('[Live] API error:', msg.error);
            setStatus('error');
            setSubStatus(`Erreur API : ${msg.error.message || msg.error.code || 'Inconnue'}`);
            setErrorDetail('Vérifiez votre clé API et les quotas Gem.');
            setCanRetry(true);
            cleanup();
          }

        } catch (parseErr) {
          console.warn('[Live] Parse message error:', parseErr);
        }
      };

      ws.onerror = (e) => {
        console.error('[Live] WS error:', e);
        if (!isMountedRef.current) return;
        setStatus('error');
        setSubStatus('Erreur WebSocket.');
        setErrorDetail('Connexion au serveur Gem impossible. Vérifiez votre réseau.');
        setCanRetry(true);
        cleanup();
      };

      ws.onclose = (e) => {
        console.log('[Live] WS fermé:', e.code, e.reason);
        if (!isMountedRef.current) return;
        wsReadyRef.current = false;

        if (e.code === 1000) return; // Fermeture normale (hangup)

        const count = reconnectRef.current;
        if (count < MAX_RECONNECTS && status !== 'error') {
          reconnectRef.current = count + 1;
          const delay = Math.pow(2, count) * 1500;
          setReconnectCount(count + 1);
          setStatus('connecting');
          setSubStatus(`Reconnexion dans ${(delay / 1000).toFixed(0)}s… (${count + 1}/${MAX_RECONNECTS})`);
          setTimeout(() => { if (isMountedRef.current) startSession(); }, delay);
        } else if (e.code !== 1000) {
          let detail = '';
          if (e.code === 1008) detail = 'Clé API invalide ou quota dépassé.';
          else if (e.code === 1011) detail = 'Erreur serveur Gem.';
          else if (e.code === 1006) detail = 'Connexion réseau interrompue.';
          setStatus('error');
          setSubStatus(`Connexion fermée (code ${e.code}).`);
          setErrorDetail(detail || e.reason || 'Réessayez ou vérifiez vos logs.');
          setCanRetry(true);
          cleanup();
        }
      };

    } catch (e: any) {
      if (!isMountedRef.current) return;
      console.error('[Live] startSession error:', e.message);
      cleanup();
      setStatus('error');
      setSubStatus(e.message || 'Erreur technique.');
      setErrorDetail('Consultez la console navigateur pour plus de détails.');
      setCanRetry(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, cleanup, playChunk, startMicrophone, sendAudio, notify, onShowPayment, onClose, onUpdateUser]);

  // ── Retry manuel ────────────────────────────────────────────────────────
  const handleRetry = () => {
    reconnectRef.current = 0;
    setReconnectCount(0);
    setStatus('idle');
    setDuration(0);
    setErrorDetail('');
    startSession();
  };

  const scale = 1 + volume / 20;
  if (!user) return null;

  return (
    <div className="fixed inset-0 z-[150] bg-[#050505] flex flex-col font-sans overflow-hidden">
      {/* Ambient glow */}
      <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full blur-[150px] pointer-events-none transition-colors duration-1000 ${
        teacherSpeaking ? 'bg-emerald-900/40' : 'bg-indigo-900/30'
      }`} />

      {/* Header */}
      <div className="p-8 pt-12 text-center relative z-10 flex flex-col items-center">
        <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full backdrop-blur-md border mb-6 transition-all ${
          status === 'connected'  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' :
          status === 'connecting' ? 'bg-amber-500/10  border-amber-500/30  text-amber-400'  :
                                    'bg-red-500/10    border-red-500/30    text-red-400'
        }`}>
          {status === 'connecting' ? <Loader2      className="w-3 h-3 animate-spin" /> :
           status === 'connected'  ? <Wifi         className="w-3 h-3" /> :
                                     <AlertCircle  className="w-3 h-3" />}
          <span className="text-[10px] font-black uppercase tracking-widest">
            {status === 'connecting' ? 'CONNEXION…' : status === 'connected' ? 'EN LIGNE' : 'ERREUR'}
          </span>
        </div>

        <h2 className="text-3xl md:text-4xl font-black text-white tracking-tight drop-shadow-md">
          {user.preferences?.teacherName || 'TeacherMada'}
        </h2>
        <div className="flex items-center gap-2 mt-2 text-indigo-400 font-medium">
          <Globe className="w-4 h-4" />
          <span className="text-sm">
             {user.preferences?.targetLanguage} — {user.preferences?.level}
          </span>
        </div>

        <div className="flex items-center gap-3 mt-4 flex-wrap justify-center">
          <p className="text-slate-500 font-mono text-xs bg-slate-900/80 px-3 py-1 rounded-lg border border-slate-800 flex items-center gap-2">
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
            {[192, 256, 320, 384].map((size, i) => (
              <div key={i} className="absolute rounded-full border" style={{
                width: size, height: size,
                borderColor: `rgba(99,102,241,${0.6 - i * 0.12})`,
                transform:   `scale(${scale * (1 - i * 0.04)})`,
                opacity:     Math.min(1, volume * (0.12 - i * 0.02)),
                transition:  `transform ${75 + i * 50}ms ease-out`,
              }} />
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
          <img src="https://i.ibb.co/B2XmRwmJ/logo.png" className="w-32 h-32 object-contain drop-shadow-lg" alt="AI" />
          <div className={`absolute bottom-3 right-3 w-5 h-5 rounded-full border-2 border-[#0F1422] ${
            status === 'connected' ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'
          }`} />
        </div>

        {/* Statut + détail d'erreur */}
        <p className="text-slate-400 text-sm mt-8 font-medium text-center px-6">{subStatus}</p>
        {errorDetail && status === 'error' && (
          <p className="text-red-400/70 text-xs mt-2 text-center px-8 max-w-xs">{errorDetail}</p>
        )}

        {/* VU-mètre */}
        {status === 'connected' && !isMuted && (
          <div className="mt-4 flex items-center gap-2">
            <Activity className="w-4 h-4 text-indigo-400" />
            <div className="flex gap-0.5 items-end h-6">
              {Array.from({ length: 12 }).map((_, i) => {
                const mirror = i < 6 ? i : 11 - i;
                return (
                  <div key={i} className="w-1 rounded-full bg-indigo-500 transition-all duration-75"
                    style={{ height: Math.max(3, Math.min(24, volume * 2 * mirror / 3)) }} />
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Contrôles */}
      <div className="p-8 pb-12 flex flex-col items-center gap-5 relative z-10">
        {status === 'error' && canRetry && (
          <button onClick={handleRetry}
            className="flex items-center gap-2 px-6 py-3 bg-amber-500/20 border border-amber-500/40 text-amber-300 rounded-2xl font-bold text-sm hover:bg-amber-500/30 transition-all">
            <RefreshCw className="w-4 h-4" /> Réessayer la connexion
          </button>
        )}

        <div className="flex items-center gap-6">
          {/* Mute */}
          <button onClick={() => setIsMuted(m => !m)} disabled={status !== 'connected'}
            className={`w-16 h-16 rounded-full flex items-center justify-center transition-all shadow-lg disabled:opacity-40 ${
              isMuted
                ? 'bg-red-500/20 border-2 border-red-500/50 text-red-400 hover:bg-red-500/30'
                : 'bg-slate-800  border-2 border-slate-700  text-slate-300 hover:bg-slate-700'
            }`} title={isMuted ? 'Activer micro' : 'Couper micro'}>
            {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
          </button>

          {/* Raccrocher */}
          <button onClick={handleHangup}
            className="w-20 h-20 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center shadow-2xl shadow-red-500/40 transition-all hover:scale-105 active:scale-95"
            title="Terminer l'appel">
            <Phone className="w-8 h-8 text-white rotate-[135deg]" />
          </button>

          {/* Volume (indicateur) */}
          <button disabled
            className="w-16 h-16 rounded-full bg-slate-800 border-2 border-slate-700 text-slate-500 flex items-center justify-center opacity-40 cursor-default">
            <Volume2 className="w-6 h-6" />
          </button>
        </div>

        <p className="text-slate-600 text-xs font-mono text-center">
          {status === 'connected'
            ? `${COST_PER_MINUTE} crédits/min • Solde : ${user.credits} CRD`
            : status === 'connecting'
            ? 'Connexion en cours…'
            : 'Appel en direct'}
        </p>
      </div>
    </div>
  );
};

export default LiveTeacher;
