
import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Phone, Wifi, Loader2, AlertCircle, Activity, Volume2, Sparkles, Clock, Coins, Globe, Zap } from 'lucide-react';
import { UserProfile } from '../types';
import { GoogleGenAI, Modality } from '@google/genai';
import { storageService } from '../services/storageService';

interface LiveTeacherProps {
  user: UserProfile;
  onClose: () => void;
  onUpdateUser: (u: UserProfile) => void;
  notify: (m: string, t?: string) => void;
  onShowPayment: () => void;
}

// --- CONFIGURATION ---
const LIVE_MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const COST_PER_MINUTE = 5; 

// --- UTILS AUDIO ---
const pcmToAudioBuffer = (base64: string, ctx: AudioContext) => {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
    
    const pcm16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768.0;
    
    const buffer = ctx.createBuffer(1, float32.length, OUTPUT_SAMPLE_RATE);
    buffer.copyToChannel(float32, 0);
    return buffer;
};

const downsampleBuffer = (buffer: Float32Array, inputRate: number, outputRate: number) => {
    if (inputRate === outputRate) return buffer;
    const ratio = inputRate / outputRate;
    const newLength = Math.ceil(buffer.length / ratio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    
    while (offsetResult < newLength) {
        const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
        let accum = 0, count = 0;
        for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
            accum += buffer[i];
            count++;
        }
        result[offsetResult] = count > 0 ? accum / count : 0;
        offsetResult++;
        offsetBuffer = nextOffsetBuffer;
    }
    return result;
};

const floatTo16BitPCM = (input: Float32Array) => {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    const bytes = new Uint8Array(output.buffer);
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i += 8192) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, Math.min(i + 8192, len))));
    }
    return btoa(binary);
};

const LiveTeacher: React.FC<LiveTeacherProps> = ({ user, onClose, onUpdateUser, notify, onShowPayment }) => {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [subStatus, setSubStatus] = useState('');
  const [volume, setVolume] = useState(0); 
  const [isMuted, setIsMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [teacherSpeaking, setTeacherSpeaking] = useState(false);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef(0);
  const isMountedRef = useRef(true);

  useEffect(() => {
      isMountedRef.current = true;
      startSession();
      return () => {
          isMountedRef.current = false;
          handleHangup();
      };
  }, []);

  // --- TIMER & BILLING LOGIC ---
  useEffect(() => {
      let interval: any;
      if (status === 'connected') {
          interval = setInterval(() => {
              setDuration(d => d + 1);
          }, 1000);
      }
      return () => clearInterval(interval);
  }, [status]);

  // Billing Effect : Triggered every 60s
  useEffect(() => {
      if (duration > 0 && duration % 60 === 0) {
          processBilling();
      }
  }, [duration]);

  const processBilling = async () => {
      const success = await storageService.deductCredits(user.id, COST_PER_MINUTE);
      if (success) {
          const updatedUser = await storageService.getUserById(user.id);
          if (updatedUser) onUpdateUser(updatedUser);
          notify(`- ${COST_PER_MINUTE} Crédits`, "info");
      } else {
          notify("Crédits épuisés ! Fin de l'appel.", "error");
          handleHangup();
      }
  };

  const startSession = async () => {
      if (!(await storageService.canRequest(user.id, COST_PER_MINUTE))) {
          notify(`Il faut ${COST_PER_MINUTE} crédits minimum pour démarrer.`, "error");
          onShowPayment();
          onClose();
          return;
      }

      setStatus('connecting');
      setSubStatus("Initialisation Audio...");

      try {
          const AC = window.AudioContext || (window as any).webkitAudioContext;
          const ctx = new AC(); 
          await ctx.resume();
          audioContextRef.current = ctx;
          nextStartTimeRef.current = ctx.currentTime + 0.1;

          setSubStatus("Recherche serveur...");
          
          const keys = (process.env.API_KEY || "").split(',').map(k => k.trim()).filter(k => k.length > 10);
          if (keys.length === 0) throw new Error("Aucune clé API configurée");

          await connectWithRetry(keys, ctx);

      } catch (e: any) {
          console.error("Fatal Error", e);
          setStatus('error');
          setSubStatus(e.message || "Erreur technique");
      }
  };

  const connectWithRetry = async (keys: string[], ctx: AudioContext) => {
      let lastError = null;

      for (const apiKey of keys) {
          try {
              console.log("Tentative connexion avec clé ending in...", apiKey.slice(-4));
              const client = new GoogleGenAI({ apiKey });
              
              // --- PROMPT SYSTÈME STRICT : IMMERSION & CORRECTION ---
              const sysPrompt = `
              IDENTITY: You are "TeacherMada", a highly skilled native ${user.preferences?.targetLanguage} teacher.
              CONTEXT: User Level: ${user.preferences?.level || 'Beginner'}.
              
              AUDIO INSTRUCTIONS:
              - **SPEAK SLOWLY AND CLEARLY**. Articulate every word.
              - Use a warm, patient, and encouraging tone.
              
              LANGUAGE RULES:
              1. **PRIMARY**: Speak 90% in ${user.preferences?.targetLanguage}.
              2. **FALLBACK**: Use French ONLY for brief explanations if the user is stuck, then switch back immediately.
              
              CORRECTION PROTOCOL (CRITICAL):
              When the user makes a mistake (grammar, pronunciation, structure):
              1. **❤️ ENCOURAGE**: Start with positive reinforcement (e.g., "Good try!", "Almost there!").
              2. **✅ CORRECT**: Clearly state the correct version of the phrase.
              3. **🔄 REPEAT**: Ask the user to repeat the correct version ("Can you say: [Phrase]?").
              
              GOAL: Improve the student without reducing their confidence. Focus on progress, not perfection.
              
              START: Introduce yourself briefly in ${user.preferences?.targetLanguage}, asking how they are today.
              `;

              const session = await client.live.connect({
                  model: LIVE_MODEL,
                  config: {
                      responseModalities: [Modality.AUDIO],
                      systemInstruction: { parts: [{ text: sysPrompt }] },
                      speechConfig: {
                          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } }
                      }
                  },
                  callbacks: {
                      onopen: () => {
                          if (isMountedRef.current) {
                              setStatus('connected');
                              setSubStatus("En Ligne");
                              // Trigger auto start handled by user speaking first or system prompt behavior
                          }
                      },
                      onmessage: async (msg: any) => {
                          const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                          if (audioData) {
                              setTeacherSpeaking(true);
                              setSubStatus("TeacherMada parle...");
                              await playAudioChunk(audioData, ctx);
                          }
                          
                          if (msg.serverContent?.turnComplete) {
                              setTeacherSpeaking(false);
                              setSubStatus("Je vous écoute...");
                              if (nextStartTimeRef.current < ctx.currentTime) {
                                  nextStartTimeRef.current = ctx.currentTime;
                              }
                          }
                      },
                      onclose: () => {
                          console.log("Session closed remote");
                          handleHangup();
                      },
                      onerror: (err) => {
                          console.error("Session error", err);
                      }
                  }
              });

              await startMicrophone(ctx, session);
              return;

          } catch (e: any) {
              console.warn("Echec connexion clé", apiKey.slice(-4), e);
              lastError = e;
          }
      }
      throw lastError || new Error("Serveurs saturés (Toutes clés HS)");
  };

  const startMicrophone = async (ctx: AudioContext, session: any) => {
      try {
          const stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                  channelCount: 1,
                  echoCancellation: true,
                  noiseSuppression: true,
                  autoGainControl: true,
              }
          });
          mediaStreamRef.current = stream;

          const source = ctx.createMediaStreamSource(stream);
          const processor = ctx.createScriptProcessor(4096, 1, 1);
          processorRef.current = processor;

          processor.onaudioprocess = (e) => {
              if (isMuted) return;

              const inputData = e.inputBuffer.getChannelData(0);
              
              let sum = 0;
              for (let i = 0; i < inputData.length; i += 10) sum += inputData[i] * inputData[i];
              const rms = Math.sqrt(sum / (inputData.length / 10));
              
              setVolume(v => v * 0.8 + (rms * 100) * 0.2);

              const downsampledData = downsampleBuffer(inputData, e.inputBuffer.sampleRate, INPUT_SAMPLE_RATE);
              const base64Audio = floatTo16BitPCM(downsampledData);
              
              try {
                  session.sendRealtimeInput({
                      media: {
                          mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}`,
                          data: base64Audio
                      }
                  });
              } catch (err) {}
          };

          source.connect(processor);
          const muteNode = ctx.createGain();
          muteNode.gain.value = 0;
          processor.connect(muteNode);
          muteNode.connect(ctx.destination);

      } catch (e) {
          throw new Error("Microphone inaccessible");
      }
  };

  const playAudioChunk = async (base64: string, ctx: AudioContext) => {
      try {
          if (ctx.state === 'suspended') await ctx.resume();

          const buffer = pcmToAudioBuffer(base64, ctx);
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(ctx.destination);

          const now = ctx.currentTime;
          const startTime = Math.max(now, nextStartTimeRef.current);
          
          source.start(startTime);
          nextStartTimeRef.current = startTime + buffer.duration;
      } catch (e) {
          console.error("Playback Error", e);
      }
  };

  const handleHangup = () => {
      if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach(t => t.stop());
      if (processorRef.current) processorRef.current.disconnect();
      if (audioContextRef.current) audioContextRef.current.close().catch(() => {});
      
      mediaStreamRef.current = null;
      processorRef.current = null;
      audioContextRef.current = null;
      
      if (isMountedRef.current && status !== 'error') onClose();
  };

  // UI SCALING
  const scale = 1 + (volume / 20); 

  return (
      <div className="fixed inset-0 z-[150] bg-[#050505] flex flex-col font-sans overflow-hidden">
          
          {/* Background Ambient Glow */}
          <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full blur-[150px] pointer-events-none transition-colors duration-1000 ${teacherSpeaking ? 'bg-emerald-900/40' : 'bg-indigo-900/30'}`}></div>

          {/* Header */}
          <div className="p-8 pt-12 text-center relative z-10 flex flex-col items-center">
              <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full backdrop-blur-md border mb-6 transition-all shadow-lg ${
                  status === 'connected' 
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' 
                  : 'bg-slate-800/50 border-slate-700 text-slate-400'
              }`}>
                  {status === 'connecting' ? <Loader2 className="w-3 h-3 animate-spin"/> : <Wifi className="w-3 h-3"/>}
                  <span className="text-[10px] font-black uppercase tracking-widest">
                      {status === 'connecting' ? 'CONNEXION...' : status === 'connected' ? 'EN LIGNE' : 'ERREUR'}
                  </span>
              </div>
              
              <h2 className="text-3xl md:text-4xl font-black text-white tracking-tight drop-shadow-md">TeacherMada</h2>
              <div className="flex items-center gap-2 mt-2 text-indigo-400 font-medium">
                  <Globe className="w-4 h-4" />
                  <span className="text-sm">Immersion {user.preferences?.targetLanguage} • {user.preferences?.level}</span>
              </div>
              
              {/* Timer Only */}
              <div className="flex items-center gap-3 mt-4">
                  <p className="text-slate-500 font-mono text-xs tracking-widest bg-slate-900/80 px-3 py-1 rounded-lg border border-slate-800 flex items-center gap-2">
                      <Clock className="w-3 h-3"/>
                      {Math.floor(duration/60).toString().padStart(2,'0')}:{(duration%60).toString().padStart(2,'0')}
                  </p>
              </div>
          </div>

          {/* Visualizer Central */}
          <div className="flex-1 flex flex-col items-center justify-center relative w-full mb-10">
              
              {/* Effets d'Ondes Visuelles (User Speaking) - Concentric Circles */}
              {!teacherSpeaking && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="absolute w-48 h-48 rounded-full border border-indigo-500/60 transition-transform duration-75 ease-out" 
                             style={{ transform: `scale(${scale})`, opacity: Math.min(1, volume * 0.15) }}></div>
                        <div className="absolute w-64 h-64 rounded-full border border-indigo-500/40 transition-transform duration-100 ease-out" 
                             style={{ transform: `scale(${scale * 0.9})`, opacity: Math.min(0.6, volume * 0.1) }}></div>
                        <div className="absolute w-80 h-80 rounded-full border border-indigo-500/20 transition-transform duration-200 ease-out" 
                             style={{ transform: `scale(${scale * 0.8})`, opacity: Math.min(0.3, volume * 0.05) }}></div>
                        <div className="absolute w-96 h-96 rounded-full border border-indigo-500/10 transition-transform duration-300 ease-out" 
                             style={{ transform: `scale(${scale * 0.7})`, opacity: Math.min(0.2, volume * 0.03) }}></div>
                  </div>
              )}

              {/* Effets Pulsation (Teacher Speaking) - Glowing Aura */}
              {teacherSpeaking && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="absolute w-52 h-52 rounded-full bg-emerald-500/20 animate-ping"></div>
                        <div className="absolute w-64 h-64 rounded-full border-2 border-emerald-500/30 animate-pulse"></div>
                        <div className="absolute w-80 h-80 rounded-full bg-emerald-500/5 blur-2xl animate-pulse"></div>
                  </div>
              )}

              {/* Avatar Central */}
              <div className={`relative z-20 w-48 h-48 rounded-full bg-[#0F1422] flex items-center justify-center transition-all duration-500 shadow-2xl ${
                  teacherSpeaking 
                  ? 'scale-110 border-4 border-emerald-500 shadow-[0_0_80px_rgba(16,185,129,0.4)]' 
                  : 'border-4 border-indigo-500/30 shadow-[0_0_40px_rgba(99,102,241,0.15)]'
              }`}>
                  <img src="https://i.ibb.co/B2XmRwmJ/logo.png" className="w-32 h-32 object-contain drop-shadow-lg" alt="AI Teacher" />
                  
                  {/* Status Indicator inside Avatar */}
                  <div className={`absolute bottom-4 right-4 w-7 h-7 rounded-full border-4 border-[#0F1422] flex items-center justify-center transition-colors ${teacherSpeaking ? 'bg-emerald-500' : 'bg-indigo-500'}`}>
                      {teacherSpeaking ? <Activity className="w-3.5 h-3.5 text-white animate-bounce" /> : <Mic className="w-3.5 h-3.5 text-white" />}
                  </div>
              </div>

              {/* Status Textuel Dynamique */}
              <div className="mt-16 h-10 flex items-center gap-3 px-6 py-2 rounded-full bg-white/5 backdrop-blur-md border border-white/10 transition-all duration-300 shadow-xl">
                  {teacherSpeaking ? (
                      <>
                        <Volume2 className="w-4 h-4 text-emerald-400 animate-pulse" />
                        <span className="text-emerald-100 text-xs font-bold uppercase tracking-wide">TeacherMada parle...</span>
                      </>
                  ) : (
                      <>
                        <div className={`w-2 h-2 rounded-full ${isMuted ? 'bg-red-500' : 'bg-indigo-500 animate-pulse'}`}></div>
                        <span className="text-indigo-100 text-xs font-bold uppercase tracking-wide">
                            {isMuted ? "Micro coupé" : subStatus || "C'est à vous..."}
                        </span>
                      </>
                  )}
              </div>
          </div>

          {/* Erreur overlay */}
          {status === 'error' && (
              <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md flex items-center justify-center z-50 animate-fade-in">
                  <div className="bg-[#1E293B] p-8 rounded-3xl border border-red-500/30 text-center max-w-xs shadow-2xl">
                      <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                          <AlertCircle className="w-8 h-8 text-red-500" />
                      </div>
                      <h3 className="text-white font-black text-lg mb-2">Appel Terminé</h3>
                      <p className="text-slate-400 text-xs mb-6 font-medium leading-relaxed">{subStatus || "Vérifiez vos crédits ou votre connexion."}</p>
                      <button onClick={onClose} className="w-full py-3.5 bg-white text-slate-900 font-bold rounded-2xl hover:scale-[1.02] transition-transform">Fermer</button>
                  </div>
              </div>
          )}

          {/* Contrôles Glassmorphism */}
          <div className="p-8 pb-12 flex items-center justify-center gap-8 relative z-10">
              <button 
                  onClick={() => setIsMuted(!isMuted)}
                  className={`p-6 rounded-full transition-all duration-300 shadow-xl backdrop-blur-sm border group ${
                      isMuted 
                      ? 'bg-white text-slate-900 border-white rotate-180' 
                      : 'bg-slate-800/60 text-white border-slate-700 hover:bg-slate-700'
                  }`}
              >
                  {isMuted ? <MicOff className="w-6 h-6"/> : <Mic className="w-6 h-6 group-hover:scale-110 transition-transform"/>}
              </button>

              <button 
                  onClick={handleHangup}
                  className="w-24 h-24 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center shadow-[0_0_40px_rgba(239,68,68,0.4)] transition-all hover:scale-105 active:scale-95 group border-4 border-red-400/50"
              >
                  <Phone className="w-10 h-10 text-white fill-current rotate-[135deg] group-hover:animate-pulse" />
              </button>

              {/* Bouton Speaker fictif pour symétrie */}
              <div className="p-6 rounded-full bg-slate-800/40 text-slate-600 border border-slate-800/50 cursor-default">
                  <Volume2 className="w-6 h-6"/>
              </div>
          </div>
      </div>
  );
};

export default LiveTeacher;
