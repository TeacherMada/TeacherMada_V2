
import React, { useState, useEffect, useRef } from 'react';
import { UserProfile, ChatMessage } from '../types';
import { generateRoleplayResponse } from '../services/geminiService';
import { storageService } from '../services/storageService';
import { creditService, CREDIT_COSTS } from '../services/creditService';
import { X, Send, Mic, MessageCircle, Clock, ShoppingBag, Plane, Stethoscope, Utensils, AlertTriangle, Loader2, Play, Briefcase, ArrowLeft, Sparkles, Languages, BarChart, ArrowRight, Settings2, Globe } from 'lucide-react';

interface DialogueSessionProps {
  user: UserProfile;
  onClose: () => void;
  onUpdateUser: (user: UserProfile) => void;
  notify: (message: string, type: 'success' | 'error' | 'info') => void;
  onShowPayment: () => void; // Added Prop
}

const LANGUAGES = [
    { code: 'Anglais', label: 'Anglais 🇬🇧', bcp47: 'en-GB' },
    { code: 'Français', label: 'Français 🇫🇷', bcp47: 'fr-FR' },
    { code: 'Chinois', label: 'Chinois 🇨🇳', bcp47: 'zh-CN' },
    { code: 'Espagnol', label: 'Espagnol 🇪🇸', bcp47: 'es-ES' },
    { code: 'Allemand', label: 'Allemand 🇩🇪', bcp47: 'de-DE' },
    { code: 'Italien', label: 'Italien 🇮🇹', bcp47: 'it-IT' },
    { code: 'Portugais', label: 'Portugais 🇵🇹', bcp47: 'pt-PT' },
    { code: 'Russe', label: 'Russe 🇷🇺', bcp47: 'ru-RU' },
    { code: 'Japonais', label: 'Japonais 🇯🇵', bcp47: 'ja-JP' },
    { code: 'Coréen', label: 'Coréen 🇰🇷', bcp47: 'ko-KR' },
    { code: 'Hindi', label: 'Hindi 🇮🇳', bcp47: 'hi-IN' },
    { code: 'Arabe', label: 'Arabe 🇸🇦', bcp47: 'ar-SA' },
    { code: 'Swahili', label: 'Swahili 🇰🇪', bcp47: 'sw-KE' },
];

const LEVELS = ['Débutant (A1)', 'Élémentaire (A2)', 'Intermédiaire (B1)', 'Avancé (B2)', 'Expert (C1)'];

const SCENARIOS = [
    { id: 'freestyle', title: 'Dialogue Libre', subtitle: 'Conversation ouverte', icon: <Sparkles className="w-8 h-8"/>, color: 'bg-violet-500', prompt: "Discussion libre et naturelle sur n'importe quel sujet. Adapte-toi au niveau de l'utilisateur." },
    { id: 'greeting', title: 'Première Rencontre', subtitle: 'Bases & Politesse', icon: <MessageCircle className="w-8 h-8"/>, color: 'bg-emerald-500', prompt: "Rencontre avec un nouvel ami étranger. Salutations et présentations." },
    { id: 'market', title: 'Au Marché', subtitle: 'Négociation & Nombres', icon: <ShoppingBag className="w-8 h-8"/>, color: 'bg-orange-500', prompt: "Acheter des fruits au marché local et négocier le prix." },
    { id: 'restaurant', title: 'Restaurant', subtitle: 'Commander & Goûts', icon: <Utensils className="w-8 h-8"/>, color: 'bg-rose-500', prompt: "Commander un repas complet et demander l'addition." },
    { id: 'travel', title: 'Gare & Aéroport', subtitle: 'Orientation & Horaires', icon: <Plane className="w-8 h-8"/>, color: 'bg-sky-500', prompt: "Demander son chemin et acheter un billet de train." },
    { id: 'job', title: 'Entretien d\'Embauche', subtitle: 'Professionnel & Formel', icon: <Briefcase className="w-8 h-8"/>, color: 'bg-slate-600', prompt: "Un entretien pour un stage ou un emploi. Parler de ses qualités." },
    { id: 'doctor', title: 'Consultation', subtitle: 'Santé & Corps', icon: <Stethoscope className="w-8 h-8"/>, color: 'bg-red-500', prompt: "Expliquer des symptômes à un médecin." },
];

const getSpeechLang = (targetLang: string) => {
    const found = LANGUAGES.find(l => targetLang.includes(l.code));
    return found ? found.bcp47 : 'fr-FR';
};

const DialogueSession: React.FC<DialogueSessionProps> = ({ user, onClose, onUpdateUser, notify, onShowPayment }) => {
  // Flow State: 'setup' -> 'selection' -> 'intro' -> 'chat' -> 'score'
  const [step, setStep] = useState<'setup' | 'selection' | 'intro' | 'chat'>('setup');
  
  // Configuration
  const [selectedLang, setSelectedLang] = useState(user.preferences?.targetLanguage?.split(' ')[0] || 'Anglais');
  const [selectedLevel, setSelectedLevel] = useState(user.preferences?.level || 'Débutant (A1)');

  const [scenario, setScenario] = useState<typeof SCENARIOS[0] | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [secondsActive, setSecondsActive] = useState(0);
  
  // Correction State
  const [lastCorrection, setLastCorrection] = useState<{original: string, corrected: string, explanation: string} | null>(null);
  const [finalScore, setFinalScore] = useState<{score: number, feedback: string} | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isListening, setIsListening] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Timer Logic
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (step === 'chat' && !finalScore && !isInitializing) {
        interval = setInterval(() => {
            setSecondsActive(prev => prev + 1);
        }, 1000);
    }
    return () => {
        if (interval) clearInterval(interval);
    };
  }, [step, finalScore, isInitializing]);

  useEffect(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, lastCorrection, isLoading]);

  // --- Handlers ---

  const confirmSetup = () => {
      setStep('selection');
  };

  const selectScenario = (selected: typeof SCENARIOS[0]) => {
      setScenario(selected);
      setStep('intro');
  };

  // Helper to get a user object with overridden preferences for this session
  const getSessionUser = () => {
      return {
          ...user,
          preferences: {
              ...user.preferences!,
              targetLanguage: selectedLang,
              level: selectedLevel
          }
      };
  };

  const startSession = async () => {
      if (!scenario) return;
      
      const allowed = await creditService.checkBalance(user.id, CREDIT_COSTS.DIALOGUE_MESSAGE);
      
      if (allowed) {
          setStep('chat');
          setIsInitializing(true);
          
          try {
              // Use session-specific user config
              const sessionUser = getSessionUser();
              const result = await generateRoleplayResponse([], scenario.prompt, sessionUser, false, true);
              setMessages([{
                  id: 'sys_init',
                  role: 'model',
                  text: result.aiReply,
                  timestamp: Date.now()
              }]);
              
              const u = await storageService.getUserById(user.id);
              if (u) onUpdateUser(u);

          } catch (e) {
              notify("Erreur d'initialisation. Réessayez.", 'error');
              setScenario(null);
              setStep('selection');
          } finally {
              setIsInitializing(false);
          }
      } else {
          onShowPayment();
      }
  };

  const handleMicClick = () => {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) {
          notify("Votre navigateur ne supporte pas la reconnaissance vocale.", 'error');
          return;
      }

      if (isListening) {
          setIsListening(false);
          return;
      }

      const recognition = new SpeechRecognition();
      recognition.lang = getSpeechLang(selectedLang);
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => setIsListening(true);
      recognition.onend = () => setIsListening(false);
      recognition.onerror = (event: { error: string }) => {
          console.error("Speech error", event.error);
          setIsListening(false);
          notify("Erreur micro.", 'error');
      };
      recognition.onresult = (event: { results: { [key: number]: { [key: number]: { transcript: string } } } }) => {
          const transcript = event.results[0][0].transcript;
          if (transcript) {
              setInput(prev => prev + (prev ? ' ' : '') + transcript);
          }
      };

      recognition.start();
  };

  const handleSend = async () => {
      if (!input.trim() || !scenario) return;
      
      const userText = input;
      const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', text: userText, timestamp: Date.now() };
      
      setMessages(prev => [...prev, userMsg]);
      setInput('');
      setIsLoading(true);
      setLastCorrection(null);

      if (!(await creditService.checkBalance(user.id, CREDIT_COSTS.DIALOGUE_MESSAGE))) {
          notify("Crédits insuffisants.", 'error');
          onShowPayment();
          setIsLoading(false);
          return;
      }

      try {
          const currentHistory = [...messages, userMsg];
          const sessionUser = getSessionUser();
          const result = await generateRoleplayResponse(currentHistory, scenario.prompt, sessionUser);
          
          if (result.aiReply === "⚠️ Crédits insuffisants.") {
              notify("Crédits épuisés.", 'error');
              onShowPayment();
              return;
          }

          const updatedUser = await storageService.getUserById(user.id);
          if (updatedUser) onUpdateUser(updatedUser);

          if (result.correction) {
              setLastCorrection({
                  original: userText,
                  corrected: result.correction,
                  explanation: result.explanation || "Correction suggérée."
              });
          }

          const aiMsg: ChatMessage = { id: (Date.now() + 1).toString(), role: 'model', text: result.aiReply, timestamp: Date.now() };
          setMessages(prev => [...prev, aiMsg]);
      } catch (_e) {
          console.error(_e);
          notify("Erreur de connexion", 'error');
      } finally {
          setIsLoading(false);
      }
  };

  const handleFinish = async () => {
      if (!scenario) return;
      setIsLoading(true);
      try {
          const sessionUser = getSessionUser();
          const result = await generateRoleplayResponse(messages, scenario.prompt, sessionUser, true);
          
          const updatedUser = await storageService.getUserById(user.id);
          if (updatedUser) onUpdateUser(updatedUser);

          setFinalScore({
              score: result.score || 0,
              feedback: result.feedback || "Bravo pour ta participation !"
          });
          
          const newStats = { 
              ...user.stats, 
              dialoguesCompleted: (user.stats.dialoguesCompleted || 0) + 1 
          };
          
          const freshUser = await storageService.getUserById(user.id);
          const userWithStats = { ...(freshUser || user), stats: newStats };
          
          await storageService.saveUserProfile(userWithStats);
          onUpdateUser(userWithStats);

      } catch (_e) {
          setFinalScore({ score: 0, feedback: "Erreur lors de l'évaluation." });
      } finally {
          setIsLoading(false);
      }
  };

  const formatTime = (secs: number) => {
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // --- RENDER VIEWS ---

  // 1. SETUP VIEW
  if (step === 'setup') {
      return (
        <div className="fixed inset-0 z-[120] bg-slate-900/90 backdrop-blur-xl flex items-center justify-center p-6 animate-fade-in font-sans">
            <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-3xl p-8 shadow-2xl border border-slate-200 dark:border-slate-800 relative overflow-hidden">
                <button onClick={onClose} className="absolute top-4 right-4 p-2 bg-slate-100 dark:bg-slate-800 rounded-full hover:bg-red-50 hover:text-red-500 transition-colors"><X className="w-5 h-5"/></button>
                <div className="text-center mb-8">
                    <div className="w-20 h-20 bg-indigo-50 dark:bg-indigo-900/20 rounded-full flex items-center justify-center mx-auto mb-4 animate-bounce-slight">
                        <Settings2 className="w-10 h-10 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <h2 className="text-2xl font-black text-slate-900 dark:text-white">Configuration</h2>
                    <p className="text-slate-500 text-sm mt-1">Personnalisez votre session</p>
                </div>
                <div className="space-y-4">
                    <div>
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block flex items-center gap-2"><Globe className="w-3 h-3" /> Langue</label>
                        <div className="grid grid-cols-2 gap-2 max-h-32 overflow-y-auto scrollbar-hide">
                            {LANGUAGES.map(l => (
                                <button key={l.code} onClick={() => setSelectedLang(l.code)} className={`px-3 py-3 rounded-xl text-sm font-bold border transition-all ${selectedLang === l.code ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-transparent hover:border-slate-300'}`}>{l.label}</button>
                            ))}
                        </div>
                    </div>
                    <div>
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block flex items-center gap-2"><BarChart className="w-3 h-3" /> Niveau</label>
                        <select value={selectedLevel} onChange={(e) => setSelectedLevel(e.target.value)} className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-xl font-bold text-slate-800 dark:text-white outline-none border border-transparent focus:border-indigo-500 appearance-none cursor-pointer">
                            {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                        </select>
                    </div>
                    <button onClick={confirmSetup} className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-black rounded-2xl shadow-lg shadow-indigo-500/30 transform active:scale-95 transition-all flex items-center justify-center gap-2 mt-4">
                        Continuer <ArrowRight className="w-5 h-5" />
                    </button>
                </div>
            </div>
        </div>
      );
  }

  // 2. SCENARIO SELECTION
  if (step === 'selection') {
      return (
        <div className="fixed inset-0 z-[120] bg-slate-50 dark:bg-slate-950 flex flex-col animate-fade-in">
            <div className="p-6 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center shadow-sm z-10">
                <div className="flex items-center gap-3">
                    <button onClick={() => setStep('setup')} className="p-2 -ml-2 text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors"><ArrowLeft className="w-6 h-6"/></button>
                    <div>
                        <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Espace Dialogue</h2>
                        <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
                            <span>{selectedLang}</span>
                            <span className="w-1 h-1 bg-slate-300 rounded-full"></span>
                            <span className="text-indigo-500">{selectedLevel}</span>
                        </div>
                    </div>
                </div>
                <button onClick={onClose} className="p-2.5 bg-slate-100 dark:bg-slate-800 rounded-full hover:bg-slate-200 transition-colors"><X className="w-5 h-5"/></button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 scrollbar-hide">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-4xl mx-auto">
                    {SCENARIOS.map(s => (
                        <button 
                            key={s.id} 
                            onClick={() => selectScenario(s)}
                            className="group relative overflow-hidden bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 text-left hover:shadow-2xl hover:border-indigo-500/30 transition-all duration-300 transform hover:-translate-y-1"
                        >
                            <div className={`absolute top-0 right-0 w-24 h-24 ${s.color} opacity-10 rounded-bl-[100px] transition-transform group-hover:scale-150`}></div>
                            <div className={`w-14 h-14 ${s.color} text-white rounded-2xl flex items-center justify-center mb-4 shadow-lg group-hover:rotate-6 transition-transform`}>{s.icon}</div>
                            <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-1">{s.title}</h3>
                            <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mb-4">{s.subtitle}</p>
                            <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 font-bold text-xs uppercase tracking-wider">Commencer <ArrowLeft className="w-4 h-4 rotate-180 transition-transform group-hover:translate-x-1" /></div>
                        </button>
                    ))}
                </div>
            </div>
        </div>
      );
  }

  // 3. INTRO VIEW
  if (step === 'intro' && scenario) {
      return (
          <div className="fixed inset-0 z-[125] bg-slate-900/95 backdrop-blur-md flex items-center justify-center p-6 animate-fade-in">
              <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-[2rem] p-8 text-center shadow-2xl relative overflow-hidden border border-white/10">
                  <div className={`absolute top-0 left-0 w-full h-2 ${scenario.color}`}></div>
                  <div className={`w-20 h-20 mx-auto ${scenario.color} rounded-full flex items-center justify-center shadow-lg mb-6 animate-float`}><div className="text-white">{scenario.icon}</div></div>
                  <h2 className="text-3xl font-black text-slate-800 dark:text-white mb-2">{scenario.title}</h2>
                  <p className="text-slate-500 dark:text-slate-400 mb-8 px-4 leading-relaxed">"Tu vas être immergé dans une situation réelle. TeacherMada vous guide, corrige, apprend en temps réel"</p>
                  
                  <div className="flex gap-3">
                      <button onClick={() => setStep('selection')} className="flex-1 py-3.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold rounded-xl hover:bg-slate-200 transition-colors">Retour</button>
                      <button onClick={startSession} className="flex-[2] py-3.5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-bold rounded-xl shadow-lg hover:shadow-indigo-500/30 hover:scale-[1.02] transition-all flex items-center justify-center gap-2"><Play className="w-5 h-5 fill-current"/> C'est parti</button>
                  </div>
              </div>
          </div>
      );
  }

  // 4. CHAT & SCORE VIEW (Existing logic wrapped in 'chat' step)
  return (
    <div className="fixed inset-0 z-[120] bg-slate-50 dark:bg-slate-950 flex flex-col font-sans">
        <div className="bg-white dark:bg-slate-900 px-4 py-3 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 dark:border-slate-800 z-20 gap-3 sm:gap-0">
            <div className="flex items-center gap-3">
                <div className={`p-2.5 rounded-xl text-white shadow-md ${scenario?.color} shrink-0`}>{scenario?.icon}</div>
                <div className="flex flex-col">
                    <h3 className="font-bold text-slate-800 dark:text-white text-sm leading-tight mb-0.5">{scenario?.title}</h3>
                    <div className="flex items-center gap-2 text-[10px] font-medium text-slate-500">
                        <span className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-indigo-500 border border-slate-200 dark:border-slate-700">
                            <Languages className="w-3 h-3"/> {selectedLang}
                        </span>
                        <span className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-emerald-500 border border-slate-200 dark:border-slate-700">
                            <BarChart className="w-3 h-3"/> {selectedLevel}
                        </span>
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3"/> {formatTime(secondsActive)}</span>
                    </div>
                </div>
            </div>
            {!finalScore && (
                <button onClick={handleFinish} className="px-4 py-2 bg-red-50 dark:bg-red-900/10 text-red-600 dark:text-red-400 rounded-xl text-xs font-bold hover:bg-red-100 transition-colors flex items-center gap-2 self-end sm:self-auto"><StopCircle className="w-4 h-4"/> <span className="hidden sm:inline">Terminer</span></button>
            )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 bg-slate-50 dark:bg-slate-950 scrollbar-hide">
            {isInitializing && (
                <div className="flex justify-center py-10">
                    <div className="flex flex-col items-center gap-3"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin"/><p className="text-xs font-bold text-indigo-400 uppercase tracking-widest animate-pulse">Création du scénario...</p></div>
                </div>
            )}

            {messages.map((msg, idx) => (
                <div key={msg.id} className="flex flex-col gap-2">
                    <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] sm:max-w-[75%] p-4 rounded-2xl text-sm leading-relaxed shadow-sm ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-tr-sm' : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-100 dark:border-slate-700 rounded-tl-sm'}`}>{msg.text}</div>
                    </div>
                    {msg.role === 'user' && idx === messages.length - 2 && lastCorrection && (
                        <div className="mx-auto max-w-[85%] sm:max-w-md bg-amber-50 dark:bg-amber-900/10 border-l-4 border-amber-400 p-3 rounded-r-xl shadow-sm animate-slide-up">
                            <div className="flex items-center gap-2 mb-1">
                                <div className="p-1 bg-amber-200 dark:bg-amber-800 rounded text-amber-700 dark:text-amber-200"><AlertTriangle className="w-3 h-3"/></div>
                                <span className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase">Correction</span>
                            </div>
                            <div className="pl-7">
                                <p className="text-sm text-slate-800 dark:text-slate-200 line-through opacity-60 mb-0.5">{lastCorrection.original}</p>
                                <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400 mb-1">{lastCorrection.corrected}</p>
                                <p className="text-xs text-slate-500 dark:text-slate-400 italic">{lastCorrection.explanation}</p>
                            </div>
                        </div>
                    )}
                </div>
            ))}

            {isLoading && (
                <div className="flex justify-start">
                    <div className="bg-white dark:bg-slate-800 p-3 rounded-2xl rounded-tl-none border border-slate-100 dark:border-slate-700 flex items-center gap-2 shadow-sm">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500"/>
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">TeacherMada écrit...</span>
                    </div>
                </div>
            )}
            
            {/* Final Score View */}
            {finalScore && (
                 <div className="fixed inset-0 z-[130] bg-slate-900/90 backdrop-blur-sm flex items-center justify-center p-6 animate-fade-in">
                     <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-[2rem] p-8 text-center shadow-2xl relative overflow-hidden border border-white/10">
                         <h2 className="text-4xl font-black text-slate-800 dark:text-white mb-2">{finalScore.score}/20</h2>
                         <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-2xl mb-6 text-left border border-slate-100 dark:border-slate-700">
                             <p className="text-xs font-bold text-slate-400 uppercase mb-2">Feedback</p>
                             <p className="text-sm text-slate-600 dark:text-slate-300 italic leading-relaxed">"{finalScore.feedback}"</p>
                         </div>
                         <button onClick={onClose} className="group w-full py-4 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-black rounded-2xl shadow-xl hover:shadow-indigo-500/30 transition-all transform hover:scale-[1.02] flex items-center justify-center gap-2">
                             <span className="tracking-wide">Terminer la session</span>
                             <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform"/>
                         </button>
                     </div>
                 </div>
            )}
            <div ref={messagesEndRef} />
        </div>

        {!finalScore && !isInitializing && (
            <div className="p-4 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 z-20">
                <div className="flex gap-3 max-w-4xl mx-auto">
                    <div className="flex-1 bg-slate-100 dark:bg-slate-800 rounded-2xl p-1 flex items-center transition-all shadow-inner focus-within:ring-2 focus-within:ring-indigo-500">
                        <input 
                            type="text" 
                            value={input} 
                            onChange={e => setInput(e.target.value)} 
                            onKeyDown={e => e.key === 'Enter' && handleSend()} 
                            placeholder={`Répondez en ${selectedLang}...`} 
                            className="flex-1 bg-transparent px-4 py-3 outline-none dark:text-white placeholder:text-slate-400" 
                            disabled={isLoading} 
                            autoFocus 
                        />
                        <button 
                            onClick={handleMicClick}
                            disabled={isLoading}
                            className={`p-2.5 rounded-xl transition-all mr-1 ${isListening ? 'bg-red-500 text-white animate-pulse' : 'text-slate-400 hover:text-indigo-500 hover:bg-white dark:hover:bg-slate-700'}`}
                        >
                            <Mic className="w-5 h-5"/>
                        </button>
                    </div>
                    <button 
                        onClick={handleSend} 
                        disabled={!input.trim() || isLoading} 
                        className="p-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl disabled:opacity-50 shadow-lg"
                    >
                        <Send className="w-6 h-6" />
                    </button>
                </div>
            </div>
        )}
    </div>
  );
};

export default DialogueSession;
