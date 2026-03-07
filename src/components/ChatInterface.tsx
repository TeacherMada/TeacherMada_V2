import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Send, Phone, ArrowRight, X, Languages, Volume2, ArrowLeft, Sun, Moon, Zap, ChevronDown, Repeat, MessageCircle, Brain, Loader2, AlertTriangle, Check, Play, BookOpen, Trophy, Cloud, CloudOff, CloudLightning, Award, LogOut } from 'lucide-react';
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

// Helper to convert Raw PCM to AudioBuffer
function pcmToAudioBuffer(data: Uint8Array, ctx: AudioContext, sampleRate: number = 30000) {
  const pcm16 = new Int16Array(data.buffer);
  const float32 = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) {
    float32[i] = pcm16[i] / 32768.0;
  }
  const buffer = ctx.createBuffer(1, float32.length, sampleRate);
  buffer.copyToChannel(float32, 0);
  return buffer;
}

const ChatInterface: React.FC<Props> = ({
  user, session, onShowProfile, onExit, onUpdateUser,
  onStartPractice, onStartExercise, onStartVoiceCall, onStartExam,
  notify, onShowPayment, onChangeCourse
}) => {
  const { t } = useTranslation();

  const LOADING_PHRASES = useMemo(() => [
    t('chat.teacher_thinking'),
    t('chat.processing'),
    t('chat.recording'),
    t('chat.analyzing'),
    t('chat.drafting'),
    t('chat.correcting'),
    t('chat.searching')
  ], [t]);

  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>(session.messages);
  const [isStreaming, setIsStreaming] = useState(false);
  const [loadingText, setLoadingText] = useState(LOADING_PHRASES[0]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [currentSource, setCurrentSource] = useState<AudioBufferSourceNode | null>(null);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);

  const [showNextInput, setShowNextInput] = useState(false);
  const [nextLessonInput, setNextLessonInput] = useState('2');
  const [showStartButton, setShowStartButton] = useState(false);
  const [showTopMenu, setShowTopMenu] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => localStorage.getItem('tm_theme') === 'dark');
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('synced');
  const [unreadCount, setUnreadCount] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshSuccess, setRefreshSuccess] = useState(false);
  const [openGuideItem, setOpenGuideItem] = useState<string | null>('start_lesson');

  // ── AudioContext init ──────────────────────────────────────────────────────
  useEffect(() => {
    const initAudio = () => {
      if (!audioContext) {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        setAudioContext(ctx);
      } else if (audioContext.state === 'suspended') {
        audioContext.resume();
      }
    };
    window.addEventListener('click', initAudio, { once: true });
    window.addEventListener('touchstart', initAudio, { once: true });
    return () => {
      window.removeEventListener('click', initAudio);
      window.removeEventListener('touchstart', initAudio);
    };
  }, [audioContext]);

  // ── Loading text cycle ─────────────────────────────────────────────────────
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (isStreaming) {
      setLoadingText(LOADING_PHRASES[0]);
      let index = 0;
      interval = setInterval(() => {
        index = (index + 1) % LOADING_PHRASES.length;
        setLoadingText(LOADING_PHRASES[index]);
      }, 2000);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [isStreaming, LOADING_PHRASES]);

  // ── progressData ───────────────────────────────────────────────────────────
  const currentLessonNum = useMemo(() => {
    if (!user) return 1;
    const lastAiMessage = [...messages].reverse().find(m => m.role === 'model');
    if (lastAiMessage && typeof lastAiMessage.text === 'string') {
      const match = lastAiMessage.text.match(/(?:Leçon|Lesson)\s+(\d+)/i);
      if (match) return parseInt(match[1], 10);
    }
    return 1;
  }, [messages, user]);

  const progressData = useMemo(() => {
    if (!user) return { percentage: 0, nextLevel: 'A1', currentLevel: 'A1', completed: 0, total: 50 };
    const levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'HSK 1', 'HSK 2', 'HSK 3', 'HSK 4', 'HSK 5', 'HSK 6'];
    const currentLevel = user.preferences?.level || 'A1';
    const currentIndex = levels.indexOf(currentLevel);
    const nextLevel = currentIndex < levels.length - 1 ? levels[currentIndex + 1] : 'Expert';
    const lessonsPerLevel = 50;
    const percentage = Math.min((currentLessonNum / lessonsPerLevel) * 100, 100);
    return { percentage: Math.round(percentage), nextLevel, currentLevel, completed: currentLessonNum, total: lessonsPerLevel };
  }, [user, currentLessonNum]);

  const userFlagUrl = useMemo(() => {
    if (!user) return '';
    const lang = user.preferences?.targetLanguage || '';
    return getFlagUrl(lang.split(' ')[0]);
  }, [user]);

  const currentLessonTitle = `${t('dashboard.lessons')} ${currentLessonNum}`;
  const isLowCredits = (user?.credits ?? 0) <= 0;

  // ── PATCH 2 : Chargement intelligent de l'historique ───────────────────────
  useEffect(() => {
    if (!user) return;

    // Essayer de charger depuis localStorage d'abord
    const sessionKey = session?.id;
    if (sessionKey) {
      const localRaw = localStorage.getItem(sessionKey);
      if (localRaw) {
        try {
          const localMsgs: ChatMessage[] = JSON.parse(localRaw);
          if (Array.isArray(localMsgs) && localMsgs.length > 0) {
            // Garder le plus long (local ou mémoire)
            const src = localMsgs.length >= (session.messages?.length ?? 0) ? localMsgs : session.messages;
            const valid = src.filter(m => m && typeof m.text === 'string' && m.text.trim());
            if (valid.length > 0) {
              setMessages(valid);
              return;
            }
          }
        } catch { /* ignoré */ }
      }

      // Sinon utiliser les messages de la session
      if (session.messages?.length > 0) {
        const valid = session.messages.filter(m => m && typeof m.text === 'string' && m.text.trim());
        if (valid.length > 0) {
          setMessages(valid);
          return;
        }
      }
    }

    // Aucun historique — afficher le message de bienvenue
    if (messages.length === 0) {
      const targetLang = user.preferences?.targetLanguage;
      const level = user.preferences?.level;
      const welcomeTitle = t('chat.welcome_title');
      const welcomeBody = t('chat.welcome_text', {
        targetLang: targetLang || '',
        level: level || '',
        teacherName: user.preferences?.teacherName || 'TeacherMada'
      });
      const welcomeText = `${welcomeTitle}\n\n${welcomeBody}`;
      const initialMsg: ChatMessage = {
        id: 'welcome_msg',
        role: 'model',
        text: welcomeText,
        timestamp: Date.now()
      };
      setMessages([initialMsg]);
      setShowStartButton(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Notifications ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const checkNotifs = async () => {
      const count = await storageService.getUnreadCount(user.id);
      setUnreadCount(count);
    };
    checkNotifs();
    const interval = setInterval(checkNotifs, 60000);
    return () => clearInterval(interval);
  }, [user.id]);

  // ── Écoute mises à jour utilisateur ───────────────────────────────────────
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

  // ── Sync status ────────────────────────────────────────────────────────────
  useEffect(() => {
    const unsubscribeSync = storageService.subscribeToSyncUpdates(setSyncStatus);
    return () => unsubscribeSync();
  }, []);

  // ── Auto-scroll ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isStreaming, showStartButton]);

  // ── Thème ──────────────────────────────────────────────────────────────────
  const toggleTheme = () => {
    const newMode = !isDarkMode;
    setIsDarkMode(newMode);
    document.documentElement.classList.toggle('dark', newMode);
    localStorage.setItem('tm_theme', newMode ? 'dark' : 'light');
  };

  // ── Refresh ────────────────────────────────────────────────────────────────
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      if (user && user.preferences) {
        const latestSession = await storageService.getOrCreateSession(user.id, user.preferences);
        const valid = (latestSession.messages || []).filter(m => m && typeof m.text === 'string' && m.text.trim());
        setMessages(valid.length > 0 ? valid : messages);
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

  // ── processMessage ─────────────────────────────────────────────────────────
  const processMessage = async (text: string, isAuto: boolean = false) => {
    if (!user || isStreaming) return;
    setShowStartButton(false);

    const canRequest = await creditService.checkBalance(user.id, CREDIT_COSTS.LESSON);
    if (!canRequest) {
      notify(t('chat.buy_credits'), "error");
      onShowPayment();
      return;
    }

    const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', text, timestamp: Date.now() };
    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setInput('');
    setIsStreaming(true);

    try {
      const stream = sendMessageStream(text, user, messages);
      let fullText = '';
      const aiMsgId = (Date.now() + 1).toString();
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

      await storageService.saveSession({ ...session, messages: newMessages });

      // ── PATCH 2 : Sauvegarde intelligente localStorage (max 200 messages) ──
      try {
        const msgsToSave = newMessages.slice(-200);
        localStorage.setItem(session.id, JSON.stringify(msgsToSave));
      } catch { /* quota ignoré */ }

      if (isAuto) {
        await storageService.saveUserProfile({ ...user });
      }

    } catch (_e) {
      notify(t('chat.connection_error'), "error");
    } finally {
      setIsStreaming(false);
    }
  };

  const handleSend = () => { if (input.trim()) processMessage(input); };

  const handleStartCourse = () => {
    if (!user) return;
    const isMalagasy = user.preferences?.explanationLanguage === ExplanationLanguage.Malagasy;
    processMessage(isMalagasy ? "HANOMBOKA LESONA" : "COMMENCER");
  };

  const handleNextClick = async () => {
    if (!user) return;
    const allowed = await creditService.checkBalance(user.id, CREDIT_COSTS.LESSON);
    if (!allowed) { notify(t('chat.insufficient_credits'), "error"); onShowPayment(); return; }
    setNextLessonInput((currentLessonNum + 1).toString());
    setShowNextInput(true);
  };

  const confirmNextLesson = () => {
    if (nextLessonInput.trim()) {
      processMessage(`Commence la Leçon ${nextLessonInput}`, true);
      setShowNextInput(false);
    }
  };

  // ── TTS ────────────────────────────────────────────────────────────────────
  const handleSpeech = async (messageId: string, text: string) => {
    if (speakingMessageId === messageId) {
      if (currentSource) { currentSource.stop(); setCurrentSource(null); }
      window.speechSynthesis.cancel();
      setSpeakingMessageId(null);
      return;
    }
    if (currentSource) { currentSource.stop(); setCurrentSource(null); }
    window.speechSynthesis.cancel();
    setSpeakingMessageId(messageId);
    setIsLoadingAudio(true);

    try {
      const voiceName = user.preferences?.voiceName || 'Kore';
      const pcmBuffer = await generateSpeech(text, voiceName, CREDIT_COSTS.AUDIO_PRONUNCIATION);

      if (!pcmBuffer) {
        // Fallback navigateur
        const utterance = new SpeechSynthesisUtterance(text);
        const targetLang = user.preferences?.targetLanguage || '';
        const voices = window.speechSynthesis.getVoices();
        const langCode =
          targetLang.toLowerCase().includes('angl') ? 'en-US' :
          targetLang.toLowerCase().includes('fran') ? 'fr-FR' :
          targetLang.toLowerCase().includes('es') ? 'es-ES' :
          targetLang.toLowerCase().includes('de') ? 'de-DE' : 'en-US';
        utterance.lang = langCode;
        const voice = voices.find(v => v.lang.startsWith(langCode));
        if (voice) utterance.voice = voice;
        utterance.onend = () => setSpeakingMessageId(null);
        utterance.onerror = () => { setSpeakingMessageId(null); notify(t('chat.audio_error'), "error"); };
        window.speechSynthesis.speak(utterance);
        return;
      }

      let ctx = audioContext;
      if (!ctx) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        ctx = new AudioContextClass({ sampleRate: 24000 });
        setAudioContext(ctx);
      }
      if (ctx.state === 'suspended') await ctx.resume();

      const audioBuffer = pcmToAudioBuffer(new Uint8Array(pcmBuffer), ctx, 24000);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.onended = () => { setSpeakingMessageId(null); setCurrentSource(null); };
      source.start(0);
      setCurrentSource(source);
    } catch (e) {
      notify(t('chat.audio_error'), "error");
      setSpeakingMessageId(null);
    } finally {
      setIsLoadingAudio(false);
    }
  };

  const handleVoiceCallClick = async () => {
    if (!user) return;
    const allowed = await creditService.checkBalance(user.id, CREDIT_COSTS.VOICE_CALL_PER_MINUTE);
    if (!allowed) { notify(t('chat.voice_call_min_credits', { cost: CREDIT_COSTS.VOICE_CALL_PER_MINUTE }), "error"); onShowPayment(); return; }
    onStartVoiceCall();
  };

  const handleTranslateInput = async () => {
    if (!user || !input.trim()) return;
    const targetLang = user.preferences?.targetLanguage || 'English';
    const prompt = `Translate the following text to ${targetLang}. Return ONLY the translated text. Text: "${input}"`;
    try {
      setIsStreaming(true);
      const text = await generateText(prompt);
      if (text) setInput(text.trim());
    } catch (_e) {
      notify(t('chat.translation_error'), "error");
    } finally {
      setIsStreaming(false);
    }
  };

  // ── PATCH 3 : Déconnexion propre ───────────────────────────────────────────
  const handleLogout = async () => {
    await storageService.logout();
    onExit();
    window.location.reload();
  };

  const TEACHER_AVATAR = "https://i.ibb.co/B2XmRwmJ/logo.png";

  if (!user) return null;

  return (
    // ── PATCH 1 : position relative pour que les fixed enfants se positionnent bien
    <div
      className="relative flex flex-col h-[100dvh] bg-[#F0F2F5] dark:bg-[#0B0F19] font-sans transition-colors duration-300 overflow-hidden"
      onClick={() => setShowTopMenu(false)}
    >

      {/* ── PATCH 1 : HEADER FIXE ───────────────────────────────────────────── */}
      <header className="fixed top-0 left-0 right-0 z-30 bg-white/90 dark:bg-[#131825]/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 shadow-sm">
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

              {/* Dropdown menu */}
              {showTopMenu && (
                <div className="absolute top-full left-0 mt-2 w-52 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-100 dark:border-slate-700 overflow-hidden z-50 animate-fade-in-up">
                  <button onClick={() => { onStartPractice(); setShowTopMenu(false); }} className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200">
                    <MessageCircle className="w-4 h-4 text-indigo-500" /> {t('dashboard.start_dialogue')}
                  </button>
                  <button onClick={() => { onStartExercise(); setShowTopMenu(false); }} className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200">
                    <Brain className="w-4 h-4 text-emerald-500" /> {t('dashboard.start_exercise')}
                  </button>
                  <button onClick={() => { onStartExam(); setShowTopMenu(false); }} className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200">
                    <Trophy className="w-4 h-4 text-rose-500" /> {t('dashboard.start_exam')}
                  </button>
                  <button onClick={() => { handleVoiceCallClick(); setShowTopMenu(false); }} className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200">
                    <Phone className="w-4 h-4 text-purple-500" /> {t('dashboard.start_voice')}
                  </button>
                  <div className="h-px bg-slate-100 dark:bg-slate-700 mx-2 my-1" />
                  <button onClick={() => { onChangeCourse(); setShowTopMenu(false); }} className="w-full text-left px-4 py-3 hover:bg-orange-50 dark:hover:bg-orange-900/10 flex items-center gap-2 text-xs font-bold text-orange-500">
                    <Repeat className="w-3.5 h-3.5" /> {t('dashboard.change_course')}
                  </button>
                  {/* ── PATCH 3 : Bouton déconnexion ── */}
                  <button onClick={handleLogout} className="w-full text-left px-4 py-3 hover:bg-red-50 dark:hover:bg-red-900/10 flex items-center gap-2 text-xs font-bold text-red-500">
                    <LogOut className="w-3.5 h-3.5" /> {t('common.logout') || 'Déconnexion'}
                  </button>
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
              className={`flex items-center gap-1 cursor-pointer transition-all duration-500 px-2 py-0.5 rounded-full border ${isLowCredits
                ? 'animate-pulse text-red-600 bg-red-100 dark:bg-red-900/30 ring-2 ring-red-500 border-red-500 scale-105'
                : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 hover:scale-105'}`}
            >
              {isLowCredits ? <AlertTriangle className="w-3 h-3" /> : <Zap className="w-3 h-3 text-amber-500 fill-amber-500" />}
              <span className={`text-[10px] font-bold ${isLowCredits ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}>
                {user.credits} {t('common.credits')}
              </span>
            </div>
          </div>

          {/* Droite : refresh + thème + profil */}
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
                  {syncStatus === 'synced' && <Cloud className="w-4 h-4 text-emerald-500" />}
                  {syncStatus === 'syncing' && <CloudLightning className="w-4 h-4 text-amber-500 animate-pulse" />}
                  {syncStatus === 'offline' && <CloudOff className="w-4 h-4 text-slate-400" />}
                  {syncStatus === 'error' && <CloudOff className="w-4 h-4 text-red-500" />}
                </>
              )}
            </button>
            <button onClick={toggleTheme} className="p-2 text-slate-400 hover:text-indigo-600 rounded-full transition-colors">
              {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            <button onClick={onShowProfile} className="relative group flex items-center gap-2">
              <div className="relative">
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
              </div>
            </button>
          </div>
        </div>
      </header>

      {/* ── PATCH 1 : ZONE MESSAGES avec marges pour header/footer fixes ──────── */}
      <main className="flex-1 overflow-y-auto px-4 md:px-6 py-6 space-y-6 mt-16 mb-[72px] scrollbar-hide no-scrollbar">
        <style>{`
          .no-scrollbar::-webkit-scrollbar { display: none; }
          .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        `}</style>

        <div className="max-w-3xl mx-auto space-y-6">
          {/* Guide d'utilisation */}
          <div className="w-full mb-6 animate-fade-in">
            <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-2xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm">
              <h3 className="font-black text-slate-800 dark:text-white uppercase tracking-widest mb-4 flex items-center gap-2 text-xs">
                <BookOpen className="w-4 h-4 text-indigo-500" />
                {t('common.guide.title')}
              </h3>
              <div className="space-y-2">
                {[
                  { id: 'start_lesson', icon: Play, color: 'text-emerald-500', action: handleStartCourse },
                  { id: 'pronunciation', icon: Volume2, color: 'text-cyan-500' },
                  { id: 'exercise', icon: Brain, color: 'text-purple-500', action: onStartExercise },
                  { id: 'dialogue', icon: MessageCircle, color: 'text-blue-500', action: onStartPractice },
                  { id: 'voice_call', icon: Phone, color: 'text-indigo-500', action: handleVoiceCallClick },
                  { id: 'exam', icon: Trophy, color: 'text-rose-500', action: onStartExam },
                  { id: 'certificate', icon: Award, color: 'text-yellow-500' },
                  { id: 'credits', icon: Zap, color: 'text-amber-500', action: onShowPayment },
                  { id: 'change_course', icon: Repeat, color: 'text-red-500', action: onChangeCourse }
                ].map((item) => {
                  const isOpen = openGuideItem === item.id;
                  const guideText = t(`common.guide.${item.id}`) || item.id;
                  const [title, ...descParts] = guideText.includes(':') ? guideText.split(':') : [guideText, ''];
                  const description = descParts.join(':').trim();
                  const Icon = item.icon;

                  return (
                    <div key={item.id} className="border border-slate-100 dark:border-slate-700 rounded-xl overflow-hidden">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenGuideItem(isOpen ? null : item.id);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors text-left"
                      >
                        <Icon className={`w-4 h-4 shrink-0 ${item.color}`} />
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-200 flex-1">{title.trim()}</span>
                        <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                      </button>
                      {isOpen && (
                        <div className="px-4 pb-3 pt-1 bg-slate-50/50 dark:bg-slate-800/50">
                          {description && (
                            <p className="text-xs text-slate-500 dark:text-slate-400 mb-2 leading-relaxed">{description}</p>
                          )}
                          {item.action && (
                            <button
                              onClick={(e) => { e.stopPropagation(); item.action?.(); }}
                              className={`text-xs font-bold px-3 py-1.5 rounded-lg ${item.color} bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 hover:shadow-sm transition-all`}
                            >
                              {title.trim()} →
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Messages */}
          {messages.map((msg) => {
            if (!msg || typeof msg.text !== 'string') return null;
            return (
              <div key={msg.id} className={`flex items-end gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}>
                {msg.role === 'model' && (
                  <img src={TEACHER_AVATAR} alt="Teacher" className="w-8 h-8 rounded-full shadow-md border-2 border-white dark:border-slate-700 shrink-0 mb-1" />
                )}
                <div className={`group relative max-w-[85%] md:max-w-[75%] ${msg.role === 'user'
                  ? 'bg-indigo-600 text-white rounded-2xl rounded-br-sm px-4 py-3 shadow-md'
                  : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-2xl rounded-bl-sm px-5 py-4 shadow-sm border border-slate-100 dark:border-slate-700'
                }`}>
                  {msg.role === 'model' ? (
                    <MarkdownRenderer content={msg.text} />
                  ) : (
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                  )}
                  {msg.role === 'model' && msg.text && msg.id !== 'welcome_msg' && (
                    <button
                      onClick={() => handleSpeech(msg.id, msg.text)}
                      disabled={isLoadingAudio && speakingMessageId !== msg.id}
                      className={`absolute -bottom-3 right-3 p-1.5 rounded-full shadow-md border transition-all ${speakingMessageId === msg.id
                        ? 'bg-indigo-600 text-white border-indigo-700 animate-pulse'
                        : 'bg-white dark:bg-slate-700 text-slate-500 dark:text-slate-300 border-slate-200 dark:border-slate-600 opacity-0 group-hover:opacity-100'
                      }`}
                    >
                      {isLoadingAudio && speakingMessageId === msg.id
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <Volume2 className="w-3 h-3" />
                      }
                    </button>
                  )}
                </div>
                {msg.role === 'user' && (
                  <img
                    src={`https://api.dicebear.com/9.x/micah/svg?seed=${user.username}`}
                    alt="User"
                    className="w-8 h-8 rounded-full shadow-md border-2 border-white dark:border-slate-700 shrink-0 mb-1"
                  />
                )}
              </div>
            );
          })}

          {/* Bouton Commencer */}
          {showStartButton && (
            <div className="flex justify-center py-4 animate-fade-in">
              <button
                onClick={handleStartCourse}
                disabled={isStreaming}
                className="px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-bold text-sm shadow-lg transition-all active:scale-95 disabled:opacity-50 flex items-center gap-2"
              >
                <Play className="w-4 h-4" />
                {user.preferences?.explanationLanguage === ExplanationLanguage.Malagasy ? 'HANOMBOKA LESONA' : 'COMMENCER'}
              </button>
            </div>
          )}

          {/* Indicateur de chargement */}
          {isStreaming && (
            <div className="flex items-end gap-3 justify-start animate-fade-in">
              <img src={TEACHER_AVATAR} alt="Teacher" className="w-8 h-8 rounded-full shadow-md border-2 border-white dark:border-slate-700 shrink-0" />
              <div className="bg-white dark:bg-slate-800 rounded-2xl rounded-bl-sm px-5 py-4 shadow-sm border border-slate-100 dark:border-slate-700 flex items-center gap-3">
                <Loader2 className="w-4 h-4 text-indigo-500 animate-spin shrink-0" />
                <span className="text-sm text-slate-500 dark:text-slate-400 italic animate-pulse">{loadingText}</span>
              </div>
            </div>
          )}

          <div ref={scrollRef} className="h-1" />
        </div>
      </main>

      {/* ── PATCH 1 : FOOTER FIXE ───────────────────────────────────────────── */}
      <footer className="fixed bottom-0 left-0 right-0 z-30 bg-white/90 dark:bg-[#131825]/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 shadow-lg">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 rounded-2xl p-1 shadow-inner focus-within:ring-2 focus-within:ring-indigo-500 transition-all">
            <textarea
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                // Auto-resize
                e.target.style.height = '40px';
                e.target.style.height = Math.min(e.target.scrollHeight, 128) + 'px';
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={isLowCredits ? t('chat.low_credits_warning') : t('chat.placeholder')}
              className="flex-1 bg-transparent border-none outline-none text-slate-800 dark:text-white text-sm px-2 resize-none max-h-32 placeholder:text-slate-400 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
              rows={1}
              style={{ minHeight: '40px', height: '40px' }}
              disabled={isLowCredits}
            />

            <button
              onClick={handleTranslateInput}
              className="h-10 w-10 shrink-0 rounded-full flex items-center justify-center transition-colors text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
              title={t('chat.translate_help')}
            >
              <Languages className="w-5 h-5" />
            </button>

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
                  className="h-10 px-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-full font-bold text-xs shadow-md transition-all active:scale-95 flex items-center gap-1.5 shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {t('common.next')} <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )
            ) : (
              <button
                onClick={handleSend}
                disabled={isStreaming}
                className="h-10 w-10 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full shadow-md transition-all active:scale-95 flex items-center justify-center shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send className="w-4 h-4 ml-0.5" />
              </button>
            )}

            {/* Bouton appel vocal */}
            <button
              onClick={handleVoiceCallClick}
              className="h-10 w-10 shrink-0 rounded-full flex items-center justify-center bg-gradient-to-br from-emerald-400 to-cyan-500 text-white shadow-md hover:shadow-emerald-400/50 hover:scale-105 transition-all active:scale-95"
              title={t('dashboard.start_voice')}
            >
              <Phone className="w-4 h-4" />
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default ChatInterface;
