import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Phone, Wifi, Loader2, AlertCircle, Activity, Volume2, Sparkles, Clock, Coins, Globe, Zap, User } from 'lucide-react';
import { UserProfile } from '../types';
import { GoogleGenAI, Modality } from '@google/genai';
import { storageService } from '../services/storageService';
import { aiService } from '../services/aiService';

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
const INITIAL_BILLING_DELAY = 5000; // 5 secondes

// --- VOIX DISPONIBLES ---
interface VoiceOption {
    id: string;
    name: string;
    gender: 'M' | 'F' | 'N';
    description: string;
    emoji: string;
}

const AVAILABLE_VOICES: VoiceOption[] = [
    { id: 'Puck', name: 'Puck', gender: 'M', description: 'Énergique et dynamique', emoji: '⚡' },
    { id: 'Charon', name: 'Charon', gender: 'M', description: 'Calme et posé', emoji: '🧘' },
    { id: 'Kore', name: 'Kore', gender: 'F', description: 'Dynamique et claire', emoji: '✨' },
    { id: 'Fenrir', name: 'Fenrir', gender: 'M', description: 'Grave et autoritaire', emoji: '🦁' },
    { id: 'Aoede', name: 'Aoede', gender: 'F', description: 'Douce et mélodieuse', emoji: '🎵' },
    { id: 'Zephyr', name: 'Zephyr', gender: 'N', description: 'Neutre et professionnelle', emoji: '🌬️' },
];

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
  
  const [showVoiceSelector, setShowVoiceSelector] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<string>(
      localStorage.getItem('teachermada_preferred_voice') || 'Kore'
  );
  
  const [hasInitialBilling, setHasInitialBilling] = useState(false);
  const initialBillingTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef(0);
  const isMountedRef = useRef(true);
  
  // ID unique pour cet appel (généré au début de la session)
  const [callId] = useState(() => `call_${user.id}_${Date.now()}`);

  useEffect(() => {
      isMountedRef.current = true;
      startSession();
      return () => {
          isMountedRef.current = false;
          if (initialBillingTimerRef.current) {
              clearTimeout(initialBillingTimerRef.current);
          }
          handleHangup();
      };
  }, []);

  useEffect(() => {
      let interval: any;
      if (status === 'connected') {
          interval = setInterval(() => {
              setDuration(d => d + 1);
          }, 1000);
      }
      return () => clearInterval(interval);
  }, [status]);

  useEffect(() => {
      if (status === 'connected' && !hasInitialBilling) {
          console.log('[Billing] Scheduling initial billing in 5s...');
          
          initialBillingTimerRef.current = setTimeout(async () => {
              console.log('[Billing] Processing initial billing (5 credits)');
              await processInitialBilling();
          }, INITIAL_BILLING_DELAY);
      }
  }, [status, hasInitialBilling]);

  useEffect(() => {
      if (hasInitialBilling && duration > 0 && duration % 60 === 0) {
          console.log(`[Billing] Processing recurring billing at ${duration}s`);
          processRecurringBilling();
      }
  }, [duration, hasInitialBilling]);

  // Fonction pour raccrocher (était manquante)
  const hangup = () => {
    console.log('[Call] Hangup triggered');
    handleHangup();
  };

  // ── BILLING FUNCTIONS ──
  const processInitialBilling = async () => {
    console.log('[Billing] Processing initial billing (5 credits)');
    console.log('[Billing] User ID:', user.id);
    console.log('[Billing] Current credits:', user.credits);

    try {
        // Appeler Edge Function pour démarrer appel
        const result = await aiService.startCall(user.id);

        if (!result.success) {
            console.log('[Billing] ❌ Initial billing FAILED:', result.error);
            
            // Raccrocher si crédits insuffisants
            hangup();
            
            notify(result.error || 'Crédits insuffisants pour démarrer l\'appel', 'error');
            return;
        }

        console.log('[Billing] ✅ Initial billing SUCCESS');
        console.log('[Billing] New credits:', result.balance);
        
        // Mettre à jour l'utilisateur avec le nouveau solde
        if (result.balance !== undefined) {
            onUpdateUser({ ...user, credits: result.balance });
        }
        
        setHasInitialBilling(true);
        notify('Appel démarré (-5 crédits)', 'success');

    } catch (error: any) {
        console.error('[Billing] Exception:', error);
        hangup();
        notify('Erreur lors de la facturation', 'error');
    }
  };
  
  const processRecurringBilling = async () => {
    console.log('[Billing] Processing recurring billing (5 credits)');
    console.log('[Billing] Call ID:', callId);

    try {
        // Appeler Edge Function pour minute d'appel
        const result = await aiService.deductCallMinute(user.id, callId);

        if (!result.success) {
            console.log('[Billing] ❌ Recurring billing FAILED:', result.error);
            
            // Raccrocher si plus de crédits
            hangup();
            
            notify(result.error || 'Crédits insuffisants', 'error');
            return;
        }

        console.log('[Billing] ✅ Recurring billing SUCCESS');
        console.log('[Billing] New credits:', result.balance);
        
        // Mettre à jour l'utilisateur avec le nouveau solde
        if (result.balance !== undefined) {
            onUpdateUser({ ...user, credits: result.balance });
        }

    } catch (error: any) {
        console.error('[Billing] Exception:', error);
        hangup();
        notify('Erreur lors de la facturation', 'error');
    }
  };
  
  const handleVoiceChange = (voiceId: string) => {
      setSelectedVoice(voiceId);
      localStorage.setItem('teachermada_preferred_voice', voiceId);
      notify(`Voix changée : ${AVAILABLE_VOICES.find(v => v.id === voiceId)?.name}`, 'success');
      setShowVoiceSelector(false);
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
              
              const targetLang = user.preferences?.targetLanguage || 'English';
              const userLevel = user.preferences?.level || 'Beginner';
              
              const sysPrompt = `
═══════════════════════════════════════════════════════════════
🎓 TEACHERMADA - PROFESSIONAL LANGUAGE TEACHER
═══════════════════════════════════════════════════════════════

IDENTITY:
You are "TeacherMada", an expert ${targetLang} teacher with 30+ years of experience.
You specialize in immersive, conversational learning with gentle error correction.

STUDENT PROFILE:
- Language: ${targetLang}
- Level: ${userLevel}
- Learning Style: Audio-first, conversational practice

═══════════════════════════════════════════════════════════════
📢 AUDIO & SPEECH INSTRUCTIONS
═══════════════════════════════════════════════════════════════

VOICE QUALITY:
✓ Speak SLOWLY and CLEARLY - articulate every syllable
✓ Use natural pauses between sentences (1-2 seconds)
✓ Warm, encouraging, patient tone at all times
✓ Slightly slower pace for Beginner/Intermediate levels
✓ Normal conversational pace for Advanced

AUDIO TECHNIQUES:
✓ Emphasize KEY WORDS for clarity
✓ Use pitch variation to maintain engagement
✓ Repeat important phrases naturally
✓ Ask "Did you understand?" after complex explanations

═══════════════════════════════════════════════════════════════
🌍 LANGUAGE IMMERSION RULES
═══════════════════════════════════════════════════════════════

PRIMARY RULE:
→ Speak 95% in ${targetLang}
→ ONLY use French if:
   • Student explicitly asks "Comment dit-on...?"
   • Student is completely stuck after 2-3 attempts
   • Explaining complex grammar concepts

LANGUAGE SCAFFOLDING:
→ Beginner: Use simple sentences, common words, slower pace
→ Intermediate: Mix simple and complex structures, introduce idioms
→ Advanced: Natural conversation, complex topics, cultural nuances

═══════════════════════════════════════════════════════════════
✅ ERROR CORRECTION PROTOCOL (CRITICAL)
═══════════════════════════════════════════════════════════════

When student makes a mistake:

STEP 1 - POSITIVE REINFORCEMENT (Always start here)
   Examples:
   • "Good effort!" / "I like your thinking!"
   • "You're on the right track!"
   • "Almost perfect!"

STEP 2 - GENTLE CORRECTION (Clear but kind)
   Format: "We say: [CORRECT PHRASE]"
   Examples:
   • "We say: 'I am going' not 'I go'"
   • "The correct way is: 'She has been'"
   
STEP 3 - REPEAT REQUEST (Essential for learning)
   • "Can you try saying: [CORRECT PHRASE]?"
   • "Let's practice together: [CORRECT PHRASE]"
   
STEP 4 - BRIEF EXPLANATION (Only if needed)
   • Keep it under 15 words
   • Focus on the rule, not the theory
   Example: "We use 'am going' for actions happening now"

NEVER:
✗ Say "No" or "Wrong" directly
✗ Interrupt mid-sentence
✗ Overcorrect minor mistakes (focus on major errors)
✗ Give long grammatical explanations

═══════════════════════════════════════════════════════════════
🎯 CONVERSATION FLOW
═══════════════════════════════════════════════════════════════

SESSION STRUCTURE:

1. GREETING (First 30s)
   → Introduce yourself in ${targetLang}
   → Ask: "How are you today?"
   → Make student feel comfortable

2. TOPIC INTRODUCTION (After student responds)
   → Choose topics based on level:
      • Beginner: Daily routines, hobbies, food, family
      • Intermediate: Travel, work, opinions, past experiences
      • Advanced: Abstract concepts, debates, cultural topics
   
3. ACTIVE CONVERSATION (Main session)
   → Ask open-ended questions
   → Listen actively to student responses
   → Gently correct errors using protocol above
   → Build on what student says (active listening)
   → Introduce 2-3 new vocabulary words per minute
   
4. SILENCE HANDLING
   → If student is silent for 5+ seconds:
      "Take your time! What would you like to talk about?"
   → If still silent:
      "Should I ask you a question to get started?"

═══════════════════════════════════════════════════════════════
📚 TEACHING TECHNIQUES
═══════════════════════════════════════════════════════════════

VOCABULARY BUILDING:
→ Introduce new words IN CONTEXT
→ Use simple definitions in ${targetLang}
→ Give 1-2 example sentences
→ Ask student to use the word

PRONUNCIATION HELP:
→ Break difficult words into syllables
→ Demonstrate correct pronunciation slowly
→ Ask student to repeat 2-3 times
→ Praise progress ("Much better!")

ENGAGEMENT:
→ Ask follow-up questions
→ Share relevant cultural facts
→ Use humor (appropriate for level)
→ Celebrate small victories

═══════════════════════════════════════════════════════════════
🎓 LEVEL-SPECIFIC ADAPTATIONS
═══════════════════════════════════════════════════════════════

BEGINNER:
• Use present tense primarily
• Simple subject-verb-object sentences
• High-frequency vocabulary (top 500 words)
• Repeat key phrases naturally
• Visual descriptions when possible

INTERMEDIATE:
• Mix tenses (past, present, future)
• Compound sentences
• Common idioms and expressions
• Encourage longer responses
• Introduce subjunctive/conditional

ADVANCED:
• All tenses and moods
• Abstract discussions
• Idiomatic expressions
• Debate and opinion exchange
• Cultural and literary references

═══════════════════════════════════════════════════════════════
⚡ QUICK REFERENCE
═══════════════════════════════════════════════════════════════

GOLDEN RULES:
1. Always be encouraging
2. Correct gently, not harshly
3. Speak 95% ${targetLang}, 5% French
4. Listen actively - build on student's words
5. Make learning fun and low-stress
6. You are a natural human professor, not an AI

YOUR GOAL:
Build student's confidence and fluency through natural conversation,
not through traditional classroom drilling.

NOW: Start the session with a warm greeting in ${targetLang}!
═══════════════════════════════════════════════════════════════
              `;

              const session = await client.live.connect({
                  model: LIVE_MODEL,
                  config: {
                      responseModalities: [Modality.AUDIO],
                      systemInstruction: { parts: [{ text: sysPrompt }] },
                      speechConfig: {
                          voiceConfig: { 
                              prebuiltVoiceConfig: { 
                                  voiceName: selectedVoice
                              } 
                          }
                      }
                  },
                  callbacks: {
                      onopen: () => {
                          if (isMountedRef.current) {
                              setStatus('connected');
                              setSubStatus("En Ligne");
                              console.log('[Session] ✅ Connected successfully');
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
                          console.log("[Session] Closed by server");
                          handleHangup();
                      },
                      onerror: (err) => {
                          console.error("[Session] Error:", err);
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
      if (initialBillingTimerRef.current) {
          clearTimeout(initialBillingTimerRef.current);
      }
      
      if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach(t => t.stop());
      if (processorRef.current) processorRef.current.disconnect();
      if (audioContextRef.current) audioContextRef.current.close().catch(() => {});
      
      mediaStreamRef.current = null;
      processorRef.current = null;
      audioContextRef.current = null;
      
      if (isMountedRef.current && status !== 'error') onClose();
  };

  const scale = 1 + (volume / 20); 

  return (
      <div className="fixed inset-0 z-[150] bg-[#050505] flex flex-col font-sans overflow-hidden">
          
          <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full blur-[150px] pointer-events-none transition-colors duration-1000 ${teacherSpeaking ? 'bg-emerald-900/40' : 'bg-indigo-900/30'}`}></div>

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
                  <span className="text-sm">{user.preferences?.targetLanguage} — {user.preferences?.level}</span>
              </div>
              
              <button
                  onClick={() => setShowVoiceSelector(!showVoiceSelector)}
                  className="mt-3 flex items-center gap-2 px-4 py-2 bg-slate-800/60 hover:bg-slate-700 border border-slate-700 rounded-xl text-xs font-bold text-slate-300 transition-all"
              >
                  <User className="w-3 h-3"/>
                  Voix: {AVAILABLE_VOICES.find(v => v.id === selectedVoice)?.name}
              </button>
              
              <div className="flex items-center gap-3 mt-4">
                  <p className="text-slate-500 font-mono text-xs tracking-widest bg-slate-900/80 px-3 py-1 rounded-lg border border-slate-800 flex items-center gap-2">
                      <Clock className="w-3 h-3"/>
                      {Math.floor(duration/60).toString().padStart(2,'0')}:{(duration%60).toString().padStart(2,'0')}
                  </p>
                  {hasInitialBilling && (
                      <p className="text-amber-400 font-mono text-xs tracking-widest bg-amber-900/20 px-3 py-1 rounded-lg border border-amber-800 flex items-center gap-2">
                          <Coins className="w-3 h-3"/>
                          -{COST_PER_MINUTE * (Math.floor(duration / 60) + 1)} crédits
                      </p>
                  )}
              </div>
          </div>

          {showVoiceSelector && (
              <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                  <div className="bg-slate-900 border border-slate-700 rounded-3xl p-6 max-w-md w-full shadow-2xl">
                      <h3 className="text-white font-black text-lg mb-4 flex items-center gap-2">
                          <User className="w-5 h-5"/>
                          Choisir la Voix
                      </h3>
                      {status === 'connected' && (
                          <div className="mb-4 p-3 bg-amber-900/20 border border-amber-600/30 rounded-xl">
                              <p className="text-xs text-amber-300 flex items-center gap-2">
                                  <AlertCircle className="w-4 h-4"/>
                                  La voix sera appliquée au <strong>prochain appel</strong>
                              </p>
                          </div>
                      )}
                      <div className="grid grid-cols-2 gap-3 mb-6">
                          {AVAILABLE_VOICES.map(voice => (
                              <button
                                  key={voice.id}
                                  onClick={() => handleVoiceChange(voice.id)}
                                  className={`p-4 rounded-2xl border-2 transition-all text-left ${
                                      selectedVoice === voice.id
                                          ? 'border-indigo-500 bg-indigo-500/20'
                                          : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                                  }`}
                              >
                                  <div className="text-2xl mb-2">{voice.emoji}</div>
                                  <div className="font-bold text-white text-sm">{voice.name}</div>
                                  <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">
                                      {voice.gender === 'M' ? 'Masculin' : voice.gender === 'F' ? 'Féminin' : 'Neutre'}
                                  </div>
                                  <div className="text-xs text-slate-500">{voice.description}</div>
                              </button>
                          ))}
                      </div>
                      <button
                          onClick={() => setShowVoiceSelector(false)}
                          className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl transition-all"
                      >
                          Fermer
                      </button>
                  </div>
              </div>
          )}

          <div className="flex-1 flex flex-col items-center justify-center relative w-full mb-10">
              
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

              {teacherSpeaking && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="absolute w-52 h-52 rounded-full bg-emerald-500/20 animate-ping"></div>
                        <div className="absolute w-64 h-64 rounded-full border-2 border-emerald-500/30 animate-pulse"></div>
                        <div className="absolute w-80 h-80 rounded-full bg-emerald-500/5 blur-2xl animate-pulse"></div>
                  </div>
              )}

              <div className={`relative z-20 w-48 h-48 rounded-full bg-[#0F1422] flex items-center justify-center transition-all duration-500 shadow-2xl ${
                  teacherSpeaking 
                  ? 'scale-110 border-4 border-emerald-500 shadow-[0_0_80px_rgba(16,185,129,0.4)]' 
                  : 'border-4 border-indigo-500/30 shadow-[0_0_40px_rgba(99,102,241,0.15)]'
              }`}>
                  <img src="https://i.ibb.co/B2XmRwmJ/logo.png" className="w-32 h-32 object-contain drop-shadow-lg" alt="AI Teacher" />
                  
                  <div className={`absolute bottom-4 right-4 w-7 h-7 rounded-full border-4 border-[#0F1422] flex items-center justify-center transition-colors ${teacherSpeaking ? 'bg-emerald-500' : 'bg-indigo-500'}`}>
                      {teacherSpeaking ? <Activity className="w-3.5 h-3.5 text-white animate-bounce" /> : <Mic className="w-3.5 h-3.5 text-white" />}
                  </div>
              </div>

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
                  onClick={hangup}
                  className="w-24 h-24 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center shadow-[0_0_40px_rgba(239,68,68,0.4)] transition-all hover:scale-105 active:scale-95 group border-4 border-red-400/50"
              >
                  <Phone className="w-10 h-10 text-white fill-current rotate-[135deg] group-hover:animate-pulse" />
              </button>

              <div className="p-6 rounded-full bg-slate-800/40 text-slate-600 border border-slate-800/50 cursor-default">
                  <Volume2 className="w-6 h-6"/>
              </div>
          </div>
      </div>
  );
};

export default LiveTeacher;
