import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { memo } from 'react';
import {
  Send, Phone, ArrowRight, X, Languages, Volume2, ArrowLeft, Sun, Moon,
  Zap, ChevronDown, Repeat, MessageCircle, Brain, Loader2, StopCircle,
  AlertTriangle, Check, Play, BookOpen, Trophy, Cloud, CloudOff,
  CloudLightning, Award
} from 'lucide-react';
import { UserProfile, ChatMessage, LearningSession, ExplanationLanguage } from '../types';
import { sendMessageStream, generateSpeech, generateText } from '../services/geminiService';
import { storageService, SyncStatus } from '../services/storageService';
import { creditService, CREDIT_COSTS } from '../services/creditService';
import { getFlagUrl } from '../constants';
import MarkdownRenderer from './MarkdownRenderer';
import { useTranslation } from '../contexts/LanguageContext';

interface Props {
  user: UserProfile;
  session: LearningSession;
  onShowProfile: () => void;
  onExit: () => void;
  onUpdateUser: (u: UserProfile) => void;
  onStartPractice: () => void;
  onStartExercise: () => void;
  onStartVoiceCall: () => void;
  onStartExam: () => void;
  notify: (m: string, t?: string) => void;
  onShowPayment: () => void;
  onChangeCourse: () => void;
}

// ── PCM → AudioBuffer ─────────────────────────────────────────────────────────
function pcmToAudioBuffer(data: Uint8Array, ctx: AudioContext, sampleRate = 24000) {
  const pcm16  = new Int16Array(data.buffer);
  const f32    = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) f32[i] = pcm16[i] / 32768.0;
  const buffer = ctx.createBuffer(1, f32.length, sampleRate);
  buffer.copyToChannel(f32, 0);
  return buffer;
}

const ChatInterface: React.FC<Props> = ({
  user, session, onShowProfile, onExit, onUpdateUser,
  onStartPractice, onStartExercise, onStartVoiceCall, onStartExam,
  notify, onShowPayment, onChangeCourse
}) => {
  const { t } = useTranslation();

  const LOADING_PHRASES = useMemo(() => [
    t('chat.teacher_thinking'), t('chat.processing'), t('chat.recording'),
    t('chat.analyzing'), t('chat.drafting'), t('chat.correcting'), t('chat.searching')
  ], [t]);

  // ── États ──────────────────────────────────────────────────────────────────
  const [input,           setInput]           = useState('');
  const [messages,        setMessages]        = useState<ChatMessage[]>(session.messages);
  const [isStreaming,     setIsStreaming]      = useState(false);
  const [loadingText,     setLoadingText]      = useState(LOADING_PHRASES[0]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [isLoadingAudio,    setIsLoadingAudio]    = useState(false);

  // AudioContext partagé, fermé au démontage
  const audioCtxRef    = useRef<AudioContext | null>(null);
  const currentSrcRef  = useRef<AudioBufferSourceNode | null>(null);

  const [showNextInput,   setShowNextInput]   = useState(false);
  const [nextLessonInput, setNextLessonInput] = useState('');
  const [showStartButton, setShowStartButton] = useState(false);
  const [showTopMenu,     setShowTopMenu]     = useState(false);
  const [isDarkMode,      setIsDarkMode]      = useState(() => localStorage.getItem('tm_theme') === 'dark');
  const [syncStatus,      setSyncStatus]      = useState<SyncStatus>('synced');
  const [unreadCount,     setUnreadCount]     = useState(0);
  const [isRefreshing,    setIsRefreshing]    = useState(false);
  const [refreshSuccess,  setRefreshSuccess]  = useState(false);
  const [openGuideItem,   setOpenGuideItem]   = useState<string | null>('start_lesson');

  const TEACHER_AVATAR = 'https://i.ibb.co/B2XmRwmJ/logo.png';

  // ── Nettoyage AudioContext au démontage ────────────────────────────────────
  useEffect(() => {
    return () => {
      if (currentSrcRef.current) {
        try { currentSrcRef.current.stop(); } catch { /* ignore */ }
        currentSrcRef.current = null;
      }
      if (audioCtxRef.current) {
        try {
          if (audioCtxRef.current.state !== 'closed') audioCtxRef.current.close();
        } catch { /* ignore */ }
        audioCtxRef.current = null;
      }
      window.speechSynthesis?.cancel();
    };
  }, []);

  // ── Initialiser AudioContext au premier geste utilisateur ──────────────────
  useEffect(() => {
    const initAudio = () => {
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      } else if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
      }
    };
    window.addEventListener('click',      initAudio, { once: true });
    window.addEventListener('touchstart', initAudio, { once: true });
    return () => {
      window.removeEventListener('click',      initAudio);
      window.removeEventListener('touchstart', initAudio);
    };
  }, []);

  // ── ✅ Écouter les mises à jour de session depuis le background sync ────────
  useEffect(() => {
    const handleSessionUpdate = (event: Event) => {
      const e = event as CustomEvent<LearningSession>;
      if (e.detail?.id === session.id && (e.detail.messages?.length || 0) > messages.length) {
        console.log('[ChatInterface] Session mise à jour (BG sync):', e.detail.messages.length, 'messages');
        setMessages(e.detail.messages);
      }
    };
    window.addEventListener('tm_session_updated', handleSessionUpdate);
    return () => window.removeEventListener('tm_session_updated', handleSessionUpdate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, messages.length]);

  // ── Rotation des textes de chargement ─────────────────────────────────────
  useEffect(() => {
    if (!isStreaming) return;
    setLoadingText(LOADING_PHRASES[0]);
    let index = 0;
    const interval = setInterval(() => {
      index = (index + 1) % LOADING_PHRASES.length;
      setLoadingText(LOADING_PHRASES[index]);
    }, 2500);
    return () => clearInterval(interval);
  }, [isStreaming, LOADING_PHRASES]);

  // ── Message de bienvenue si session vide ──────────────────────────────────
  useEffect(() => {
    if (!user || messages.length > 0) return;
    const welcomeText = `${t('chat.welcome_title')}\n\n${t('chat.welcome_text', {
      targetLang:  user.preferences?.targetLanguage || '',
      level:       user.preferences?.level || '',
      teacherName: user.preferences?.teacherName || 'TeacherMada',
    })}`;
    setMessages([{ id: 'welcome_msg', role: 'model', text: welcomeText, timestamp: Date.now() }]);
    setShowStartButton(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Notifications non lues ────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const checkNotifs = async () => {
      const count = await storageService.getUnreadCount(user.id);
      setUnreadCount(count);
    };
    checkNotifs();
    const interval = setInterval(checkNotifs, 60_000);
    return () => clearInterval(interval);
  }, [user.id]);

  // ── Écouter les mises à jour de l'utilisateur (crédits etc.) ─────────────
  useEffect(() => {
    if (!user) return;
    const unsub = storageService.subscribeToUserUpdates((updated) => {
      if (updated.id === user.id) {
        onUpdateUser(updated);
        storageService.getUnreadCount(user.id).then(setUnreadCount);
      }
    });
    return () => unsub();
  }, [user.id, onUpdateUser]);

  // ── Sync status ───────────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = storageService.subscribeToSyncUpdates(setSyncStatus);
    return () => unsub();
  }, []);

  // ── Thème ─────────────────────────────────────────────────────────────────
  const toggleTheme = () => {
    const newMode = !isDarkMode;
    setIsDarkMode(newMode);
    document.documentElement.classList.toggle('dark', newMode);
    localStorage.setItem('tm_theme', newMode ? 'dark' : 'light');
  };

  // ── Refresh manuel ────────────────────────────────────────────────────────
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      if (user?.preferences) {
        const latestSession = await storageService.getOrCreateSession(user.id, user.preferences);
        setMessages(latestSession.messages);
        const updatedUser = await storageService.getUserById(user.id);
        if (updatedUser) onUpdateUser(updatedUser);
      }
      setRefreshSuccess(true);
      setTimeout(() => setRefreshSuccess(false), 2000);
    } catch (e) {
      console.error(e);
    } finally {
      setIsRefreshing(false);
    }
  };

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming, showStartButton]);

  // ── TTS : arrêter la lecture ──────────────────────────────────────────────
  const stopSpeaking = useCallback(() => {
    if (currentSrcRef.current) {
      try { currentSrcRef.current.stop(); } catch { /* ignore */ }
      currentSrcRef.current = null;
    }
    window.speechSynthesis?.cancel();
    setSpeakingMessageId(null);
    setIsLoadingAudio(false);
  }, []);

  // ── TTS : lire un message ─────────────────────────────────────────────────
  // ✅ -1 crédit à CHAQUE clic (pas de cache, comportement voulu)
  const playMessageAudio = useCallback(async (text: string, id: string, cost: number = CREDIT_COSTS.AUDIO_MESSAGE) => {
    if (!user) return;

    // Clic sur le même message en cours → arrêter
    if (speakingMessageId === id) {
      stopSpeaking();
      return;
    }

    const canPlay = await creditService.checkBalance(user.id, cost);
    if (!canPlay) {
      notify(t('chat.insufficient_credits'), 'error');
      onShowPayment();
      return;
    }

    stopSpeaking();
    setIsLoadingAudio(true);
    setSpeakingMessageId(id);

    try {
      const cleanText  = text.replace(/[#*`_]/g, '').replace(/\[Leçon \d+\]/gi, '').trim();
      const pcmBuffer  = await generateSpeech(cleanText, user.preferences?.voiceName || 'Kore', cost);

      if (!pcmBuffer) {
        // Fallback : synthèse vocale du navigateur (gratuite, pas de crédit)
        console.warn('[TTS] Gemini échoué — fallback navigateur');
        const utterance = new SpeechSynthesisUtterance(cleanText);
        const targetLang = user.preferences?.targetLanguage || '';
        const langCode   = targetLang.toLowerCase().includes('fr') ? 'fr-FR'
          : targetLang.toLowerCase().includes('es') ? 'es-ES'
          : targetLang.toLowerCase().includes('de') ? 'de-DE'
          : targetLang.toLowerCase().includes('zh') ? 'zh-CN'
          : targetLang.toLowerCase().includes('ar') ? 'ar-SA'
          : 'en-US';
        utterance.lang  = langCode;
        const voices    = window.speechSynthesis.getVoices();
        const voice     = voices.find(v => v.lang.startsWith(langCode));
        if (voice) utterance.voice = voice;
        utterance.onend   = () => setSpeakingMessageId(null);
        utterance.onerror = () => { setSpeakingMessageId(null); notify(t('chat.audio_error'), 'error'); };
        window.speechSynthesis.speak(utterance);
        return;
      }

      // Créer ou récupérer le contexte audio
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') await ctx.resume();

      const audioBuffer = pcmToAudioBuffer(new Uint8Array(pcmBuffer), ctx, 24000);
      const source      = ctx.createBufferSource();
      source.buffer     = audioBuffer;
      source.connect(ctx.destination);
      source.onended    = () => { setSpeakingMessageId(null); currentSrcRef.current = null; };
      source.start(0);
      currentSrcRef.current = source;

    } catch (e) {
      console.error('[TTS] Erreur lecture:', e);
      notify(t('chat.audio_error'), 'error');
      setSpeakingMessageId(null);
    } finally {
      setIsLoadingAudio(false);
    }
  }, [user, speakingMessageId, stopSpeaking, notify, t, onShowPayment]);

  // ── Appel vocal ───────────────────────────────────────────────────────────
  const handleVoiceCallClick = async () => {
    if (!user) return;
    const allowed = await creditService.checkBalance(user.id, CREDIT_COSTS.VOICE_CALL_PER_MINUTE);
    if (!allowed) {
      notify(t('chat.voice_call_min_credits', { cost: CREDIT_COSTS.VOICE_CALL_PER_MINUTE }), 'error');
      onShowPayment();
      return;
    }
    onStartVoiceCall();
  };

  // ── Traduction de l'input ─────────────────────────────────────────────────
  const handleTranslateInput = async () => {
    if (!user || !input.trim()) return;
    try {
      setIsStreaming(true);
      const targetLang = user.preferences?.targetLanguage || 'English';
      const text = await generateText(`Translate the following to ${targetLang}. Return ONLY the translation, nothing else: "${input}"`);
      if (text) setInput(text.trim());
    } catch { notify(t('chat.translation_error'), 'error'); }
    finally { setIsStreaming(false); }
  };

  // ── Numéro de leçon courant ───────────────────────────────────────────────
  const currentLessonNum = useMemo(() => {
    const lastAi = [...messages].reverse().find(m => m.role === 'model');
    if (lastAi) {
      const match = lastAi.text.match(/(?:Leçon|Lesson)\s+(\d+)/i);
      if (match) return parseInt(match[1], 10);
    }
    return 1;
  }, [messages]);

  const currentLessonTitle = `${t('dashboard.lessons')} ${currentLessonNum}`;

  // ── Progression ───────────────────────────────────────────────────────────
  const progressData = useMemo(() => {
    if (!user) return { percentage: 0, nextLevel: 'A1', currentLevel: 'A1', completed: 0, total: 50 };
    const levels = ['A1','A2','B1','B2','C1','C2','HSK 1','HSK 2','HSK 3','HSK 4','HSK 5','HSK 6'];
    const currentLevel = user.preferences?.level || 'A1';
    const currentIndex = levels.indexOf(currentLevel);
    const nextLevel    = currentIndex < levels.length - 1 ? levels[currentIndex + 1] : 'Expert';
    const percentage   = Math.min((currentLessonNum / 50) * 100, 100);
    return { percentage: Math.round(percentage), nextLevel, currentLevel, completed: currentLessonNum, total: 50 };
  }, [user, currentLessonNum]);

  const userFlagUrl = useMemo(() => {
    const lang = user?.preferences?.targetLanguage || '';
    return getFlagUrl(lang.split(' ')[0]);
  }, [user]);

  const isLowCredits = (user?.credits || 0) <= 0;

  // ── Envoyer un message ────────────────────────────────────────────────────
  const processMessage = async (text: string, isAuto = false) => {
    if (!user || isStreaming) return;
    setShowStartButton(false);

    const canRequest = await creditService.checkBalance(user.id, CREDIT_COSTS.LESSON);
    if (!canRequest) {
      notify(t('chat.buy_credits'), 'error');
      onShowPayment();
      return;
    }

    const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', text, timestamp: Date.now() };
    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setInput('');
    setIsStreaming(true);

    try {
      const stream    = sendMessageStream(text, user, messages);
      let fullText    = '';
      const aiMsgId   = (Date.now() + 1).toString();
      setMessages(prev => [...prev, { id: aiMsgId, role: 'model', text: '', timestamp: Date.now() }]);

      for await (const chunk of stream) {
        if (chunk) {
          fullText += chunk;
          setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, text: fullText } : m));
          scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
      }

      const newMessages = [
        ...newHistory,
        { id: aiMsgId, role: 'model' as const, text: fullText, timestamp: Date.now() }
      ];

      // ✅ Sauvegarde immédiate en localStorage ET Supabase
      await storageService.saveSession({ ...session, messages: newMessages });

      // ✅ Notifier App.tsx de la mise à jour
      window.dispatchEvent(new CustomEvent('tm_session_updated', {
        detail: { ...session, messages: newMessages }
      }));

      if (isAuto) await storageService.saveUserProfile({ ...user });

    } catch {
      notify(t('chat.connection_error'), 'error');
    } finally {
      setIsStreaming(false);
    }
  };

  const handleSend        = () => { if (input.trim()) processMessage(input); };
  const handleStartCourse = () => {
    if (!user) return;
    const isMalagasy = user.preferences?.explanationLanguage === ExplanationLanguage.Malagasy;
    processMessage(isMalagasy ? 'HANOMBOKA LESONA' : 'COMMENCER');
  };

  const handleNextClick = async () => {
    if (!user) return;
    const allowed = await creditService.checkBalance(user.id, CREDIT_COSTS.LESSON);
    if (!allowed) { notify(t('chat.insufficient_credits'), 'error'); onShowPayment(); return; }
    setNextLessonInput((currentLessonNum + 1).toString());
    setShowNextInput(true);
  };

  const confirmNextLesson = () => {
    if (nextLessonInput.trim()) {
      processMessage(`Commence la Leçon ${nextLessonInput}`, true);
      setShowNextInput(false);
    }
  };

  if (!user) return null;

  return (
    <div
      className="flex flex-col h-[100dvh] bg-[#F0F2F5] dark:bg-[#0B0F19] font-sans transition-colors duration-300 overflow-hidden"
      onClick={() => setShowTopMenu(false)}
    >

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <header className="shrink-0 fixed top-0 left-0 right-0 w-full z-30 bg-white/80 dark:bg-[#131825]/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">

          {/* Gauche : retour + menu langue */}
          <div className="flex items-center gap-3 flex-1">
            <button onClick={onExit} className="p-2 -ml-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors shrink-0">
              <ArrowLeft className="w-6 h-6" />
            </button>
            <div className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setShowTopMenu(!showTopMenu); }}
                className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-700 shadow-sm hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              >
                <img src={userFlagUrl} alt="Flag" className="w-5 h-auto rounded-sm shadow-sm" />
                <span className="text-xs font-black text-indigo-600 dark:text-indigo-400 uppercase">{progressData.currentLevel}</span>
                <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${showTopMenu ? 'rotate-180' : ''}`} />
              </button>
              {showTopMenu && (
                <div className="absolute top-full left-0 mt-2 w-48 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-100 dark:border-slate-700 overflow-hidden z-50 animate-fade-in-up">
                  <button onClick={onStartPractice}  className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200"><MessageCircle className="w-4 h-4 text-indigo-500" /> {t('dashboard.start_dialogue')}</button>
                  <button onClick={onStartExercise}  className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200"><Brain        className="w-4 h-4 text-emerald-500" /> {t('dashboard.start_exercise')}</button>
                  <button onClick={onStartExam}      className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200"><Trophy       className="w-4 h-4 text-rose-500" />    {t('dashboard.start_exam')}</button>
                  <button onClick={handleVoiceCallClick} className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200"><Phone       className="w-4 h-4 text-purple-500" />  {t('dashboard.start_voice')}</button>
                  <div className="h-px bg-slate-100 dark:bg-slate-700 mx-2 my-1" />
                  <button onClick={onChangeCourse}   className="w-full text-left px-4 py-3 hover:bg-red-50 dark:hover:bg-red-900/10 flex items-center gap-2 text-xs font-bold text-red-500"><Repeat className="w-3.5 h-3.5" /> {t('dashboard.change_course')}</button>
                </div>
              )}
            </div>
          </div>

          {/* Centre : leçon + crédits */}
          <div className="flex flex-col items-center justify-center shrink-0">
            <h1 className="text-xs font-black text-slate-800 dark:text-white uppercase tracking-widest leading-tight mb-0.5">
              {currentLessonTitle}
            </h1>
            <div
              onClick={onShowPayment}
              className={`flex items-center gap-1 cursor-pointer transition-all px-2 py-0.5 rounded-full border ${
                isLowCredits
                  ? 'animate-pulse text-red-600 bg-red-100 dark:bg-red-900/30 ring-2 ring-red-500 border-red-500 scale-105'
                  : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 hover:scale-105'
              }`}
            >
              {isLowCredits ? <AlertTriangle className="w-3 h-3" /> : <Zap className="w-3 h-3 text-amber-500 fill-amber-500" />}
              <span className={`text-[10px] font-bold ${isLowCredits ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}>
                {user.credits} {t('common.credits')}
              </span>
            </div>
          </div>

          {/* Droite : refresh, thème, profil */}
          <div className="flex items-center justify-end gap-3 flex-1">
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800 p-2 rounded-full transition-colors disabled:opacity-50"
              title={t('common.refresh_app') || "Actualiser"}
            >
              {isRefreshing ? (
                <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" />
              ) : refreshSuccess ? (
                <Check className="w-4 h-4 text-emerald-500" />
              ) : (
                <>
                  {syncStatus === 'synced'  && <Cloud          className="w-4 h-4 text-emerald-500" />}
                  {syncStatus === 'syncing' && <CloudLightning  className="w-4 h-4 text-amber-500 animate-pulse" />}
                  {(syncStatus === 'offline' || syncStatus === 'error') && <CloudOff className="w-4 h-4 text-slate-400" />}
                </>
              )}
            </button>
            <button onClick={toggleTheme} className="p-2 text-slate-400 hover:text-indigo-600 rounded-full transition-colors">
              {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            <button onClick={onShowProfile} className="relative">
              <img
                src={`https://api.dicebear.com/9.x/micah/svg?seed=${user.username}`}
                alt="User"
                className="w-9 h-9 rounded-full bg-slate-200 dark:bg-slate-800 shadow-md border border-white dark:border-slate-600"
              />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center border-2 border-white dark:border-slate-900 animate-bounce">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* ── CHAT AREA ──────────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto px-4 md:px-6 pt-20 pb-36 space-y-6 no-scrollbar">
        <style>{`.no-scrollbar::-webkit-scrollbar{display:none}.no-scrollbar{-ms-overflow-style:none;scrollbar-width:none}`}</style>
        <div className="max-w-3xl mx-auto space-y-6">

          {/* Guide accordéon */}
          <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-2xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm">
            <h3 className="font-black text-slate-800 dark:text-white uppercase tracking-widest mb-4 flex items-center gap-2 text-xs">
              <BookOpen className="w-4 h-4 text-indigo-500" />
              {t('common.guide.title')}
            </h3>
            <div className="space-y-2">
              {[
                { id: 'start_lesson',  icon: Play,          color: 'text-emerald-500', action: handleStartCourse },
                { id: 'pronunciation', icon: Volume2,        color: 'text-cyan-500' },
                { id: 'exercise',      icon: Brain,          color: 'text-purple-500',  action: onStartExercise },
                { id: 'dialogue',      icon: MessageCircle,  color: 'text-blue-500',    action: onStartPractice },
                { id: 'voice_call',    icon: Phone,          color: 'text-indigo-500',  action: handleVoiceCallClick },
                { id: 'exam',          icon: Trophy,         color: 'text-rose-500',    action: onStartExam },
                { id: 'certificate',   icon: Award,          color: 'text-yellow-500' },
                { id: 'credits',       icon: Zap,            color: 'text-amber-500',   action: onShowPayment },
                { id: 'change_course', icon: Repeat,         color: 'text-red-500',     action: onChangeCourse },
              ].map((item) => {
                const isOpen    = openGuideItem === item.id;
                const guideText = t(`common.guide.${item.id}`);
                const [title, ...descParts] = guideText.includes(':') ? guideText.split(':') : [guideText, ''];
                const description = descParts.join(':').trim();
                return (
                  <div key={item.id} className="border border-slate-100 dark:border-slate-700/50 rounded-xl overflow-hidden">
                    <div className="w-full flex items-center justify-between p-3 bg-slate-50/50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors">
                      <div
                        className={`flex items-center gap-3 flex-1 ${item.action ? 'cursor-pointer group' : ''}`}
                        onClick={(e) => {
                          if (item.action) { e.stopPropagation(); item.action(); }
                          else setOpenGuideItem(isOpen ? null : item.id);
                        }}
                      >
                        <item.icon className={`w-4 h-4 ${item.color}`} />
                        <span className={`text-xs font-bold ${item.action ? 'text-indigo-600 dark:text-indigo-400 group-hover:underline' : 'text-slate-700 dark:text-slate-200'}`}>
                          {title.trim()}
                        </span>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); setOpenGuideItem(isOpen ? null : item.id); }}
                        className="p-1 -mr-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition-colors"
                      >
                        <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                      </button>
                    </div>
                    {isOpen && description && (
                      <div className="p-3 pt-0 bg-slate-50/50 dark:bg-slate-800/50 text-xs text-slate-500 dark:text-slate-400 leading-relaxed border-t border-slate-100 dark:border-slate-700/50">
                        {description}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Messages */}
          {messages.map((msg, idx) => (
            <div key={msg.id || idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-slide-up group`}>
              {msg.role === 'model' && (
                <div
                  onClick={onExit}
                  title="Retour à l'accueil"
                  className="w-10 h-10 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center mr-3 mt-1 shrink-0 overflow-hidden shadow-sm cursor-pointer hover:scale-110 transition-transform"
                >
                  <img src={TEACHER_AVATAR} className="w-full h-full object-cover p-1" alt="Teacher" />
                </div>
              )}
              <div className={`max-w-[90%] md:max-w-[80%] p-5 rounded-2xl text-sm leading-relaxed shadow-sm ${
                msg.role === 'user'
                  ? 'bg-indigo-600 text-white rounded-tr-sm shadow-indigo-500/20 [&_*]:text-white'
                  : 'bg-white dark:bg-[#131825] text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-tl-sm'
              }`}>
                <MarkdownRenderer
                  content={msg.text.replace(/\[Leçon \d+\]/g, '')}
                  onPlayAudio={(text) => playMessageAudio(text, msg.id + text, CREDIT_COSTS.AUDIO_PRONUNCIATION)}
                />
                {msg.role === 'model' && (
                  <div className="mt-2 flex justify-end">
                    <button
                      onClick={() => speakingMessageId === msg.id ? stopSpeaking() : playMessageAudio(msg.text, msg.id, CREDIT_COSTS.AUDIO_MESSAGE)}
                      className={`px-3 py-1.5 rounded-full transition-all flex items-center gap-2 ${
                        speakingMessageId === msg.id
                          ? 'bg-indigo-100 text-indigo-600'
                          : 'text-slate-500 hover:text-indigo-600 hover:bg-slate-100'
                      }`}
                      title="Écouter ce message (-1 crédit)"
                    >
                      <span className="text-xs font-bold">{t('common.listen')}</span>
                      {isLoadingAudio && speakingMessageId === msg.id
                        ? <Loader2   className="w-4 h-4 animate-spin" />
                        : speakingMessageId === msg.id
                          ? <StopCircle className="w-4 h-4" />
                          : <Volume2    className="w-4 h-4" />
                      }
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Bouton démarrer */}
          {showStartButton && !isStreaming && (
            <div className="flex flex-col items-center gap-4 w-full max-w-sm mx-auto animate-fade-in-up">
              <button
                onClick={handleStartCourse}
                className="w-full px-8 py-4 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-black rounded-2xl shadow-xl hover:scale-105 transition-transform flex items-center justify-center gap-3 active:scale-95 text-lg"
              >
                <Play className="w-6 h-6 fill-current" />
                {t('chat.start_button')}
              </button>
            </div>
          )}

          {/* Indicateur de streaming */}
          {isStreaming && (
            <div className="flex justify-start animate-fade-in-up">
              <div className="w-10 h-10 mr-3" />
              <div className="bg-white dark:bg-slate-800 px-4 py-3 rounded-2xl rounded-tl-sm border border-slate-200 dark:border-slate-700 shadow-sm flex items-center gap-3">
                <div className="flex gap-1 shrink-0">
                  <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" />
                  <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce delay-75" />
                  <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce delay-150" />
                </div>
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400 animate-pulse min-w-[120px]">
                  {loadingText}
                </span>
              </div>
            </div>
          )}

          <div ref={scrollRef} className="h-4" />
        </div>
      </main>

      {/* ── FOOTER ─────────────────────────────────────────────────────────── */}
      <footer className="shrink-0 fixed bottom-0 left-0 right-0 w-full bg-white/95 dark:bg-[#131825]/95 backdrop-blur-lg border-t border-slate-200 dark:border-slate-800 z-30 shadow-2xl">
        <div className="max-w-3xl mx-auto p-4 flex flex-col gap-3">
          {/* Barre de progression */}
          <div className="flex items-center justify-between gap-3 px-2">
            <span className="text-[10px] font-black text-indigo-500 dark:text-indigo-400 uppercase min-w-[30px]">
              {progressData.currentLevel}
            </span>
            <div className="flex-1 h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden relative border border-slate-200 dark:border-slate-700">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 to-purple-600 transition-all duration-1000 ease-out"
                style={{ width: `${progressData.percentage}%` }}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-[8px] font-bold text-slate-500 dark:text-slate-400 bg-white/50 dark:bg-black/50 px-1.5 rounded-full backdrop-blur-sm">
                  {progressData.percentage}%
                </span>
              </div>
            </div>
            <span className="text-[10px] font-black text-slate-400 uppercase min-w-[30px] text-right">
              {progressData.nextLevel}
            </span>
          </div>

          {/* Zone de saisie */}
          <div className={`flex items-end gap-2 bg-slate-100 dark:bg-slate-800 p-2 rounded-[1.5rem] border transition-all shadow-inner ${
            isLowCredits ? 'border-red-500/50' : 'border-transparent focus-within:border-indigo-500/30'
          }`}>
            {/* Bouton appel vocal */}
            <button
              onClick={handleVoiceCallClick}
              className="h-10 w-10 shrink-0 rounded-full flex items-center justify-center bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-[0_0_20px_rgba(99,102,241,0.5)] animate-pulse hover:scale-110 transition-transform active:scale-95 border-2 border-white/20"
              title="Appel Vocal IA"
            >
              <Phone className="w-5 h-5 fill-current" />
            </button>

            {/* Textarea */}
            <textarea
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = '40px';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleSend(); }
              }}
              placeholder={isLowCredits ? t('chat.low_credits_warning') : t('chat.placeholder')}
              className="flex-1 bg-transparent border-none outline-none text-slate-800 dark:text-white text-sm px-2 resize-none max-h-32 placeholder:text-slate-400 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
              rows={1}
              style={{ minHeight: '40px', height: '40px' }}
              disabled={isLowCredits}
            />

            {/* Traduction */}
            <button
              onClick={handleTranslateInput}
              className="h-10 w-10 shrink-0 rounded-full flex items-center justify-center transition-colors text-slate-400 hover:text-indigo-500 hover:bg-indigo-50"
              title={t('chat.translate_help')}
            >
              <Languages className="w-5 h-5" />
            </button>

            {/* Envoyer / Leçon suivante */}
            {input.trim().length === 0 ? (
              showNextInput ? (
                <div className="h-10 flex items-center gap-1 bg-white dark:bg-slate-900 rounded-full px-1 border border-indigo-500/30 animate-fade-in shadow-sm">
                  <span className="text-[10px] font-bold text-slate-400 uppercase pl-2">{t('dashboard.lessons')}</span>
                  <input
                    type="number"
                    value={nextLessonInput}
                    onChange={(e) => setNextLessonInput(e.target.value)}
                    className="w-10 bg-transparent font-black text-indigo-600 dark:text-indigo-400 outline-none text-center text-sm"
                    autoFocus
                    onKeyDown={(e) => { if (e.key === 'Enter') confirmNextLesson(); }}
                  />
                  <button onClick={confirmNextLesson} className="p-1.5 bg-indigo-600 rounded-full text-white hover:bg-indigo-700 transition-colors"><Check size={14} /></button>
                  <button onClick={() => setShowNextInput(false)} className="p-1.5 text-slate-400 hover:text-red-500 transition-colors"><X size={14} /></button>
                </div>
              ) : (
                <button
                  onClick={handleNextClick}
                  disabled={isStreaming}
                  className="h-10 px-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-full font-bold text-xs shadow-md transition-all active:scale-95 flex items-center gap-1.5 shrink-0 disabled:opacity-50"
                >
                  {t('common.next')} <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )
            ) : (
              <button
                onClick={handleSend}
                disabled={isStreaming}
                className="h-10 w-10 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full shadow-md transition-all active:scale-95 flex items-center justify-center shrink-0 disabled:opacity-50"
              >
                <Send className="w-4 h-4 ml-0.5" />
              </button>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
};

//export default memo(ChatInterface);
};

const MemoizedChatInterface = memo(ChatInterface);

export default MemoizedChatInterface;
