import React, { useState, useEffect } from 'react';
import LandingPage from './components/LandingPage';
import AuthScreen from './components/AuthScreen';
import Onboarding from './components/Onboarding';
import ChatInterface from './components/ChatInterface';
import SmartDashboard from './components/SmartDashboard';
import ExerciseSession from './components/ExerciseSession';
import DialogueSession from './components/DialogueSession';
// import ExamHub from './modules/SmartExam'; // Lazy Loaded below
import PaymentModal from './components/PaymentModal';
import AdminDashboard from './components/AdminDashboard';
import TutorialAgent from './components/TutorialAgent';
import LiveTeacher from './components/LiveTeacher'; 
import VerifyCertificate from './components/VerifyCertificate'; // Added
import { UserProfile, LearningSession, ExerciseItem, UserStats, LearningMode } from './types';
import type { UserPreferences } from './types';
import { storageService } from './services/storageService';
import { supabase } from './lib/supabase';
import { generateExerciseFromHistory } from './services/geminiService'; // Added
import { Toaster, toast } from './components/Toaster';
import { Loader2 } from 'lucide-react';
import { LanguageProvider } from './contexts/LanguageContext';

import DebugConsole from './components/DebugConsole';

// Lazy Load Heavy Modules
const ExamHub = React.lazy(() => import('./modules/SmartExam'));

// Mock Guest User for Landing Page Chatbot
const GUEST_USER: UserProfile = {
  id: 'guest',
  username: 'Visiteur',
  role: 'user',
  createdAt: Date.now(),
  preferences: {
    targetLanguage: 'Français',
    level: 'Débutant',
    explanationLanguage: 'Français',
    mode: LearningMode.Course,
    voiceName: 'Zephyr'
  },
  stats: { lessonsCompleted: 0, exercisesCompleted: 0, dialoguesCompleted: 0 },
  vocabulary: [],
  credits: 0,
  xp: 0, // Fix: Added missing XP
  freeUsage: { lastResetWeek: new Date().toISOString(), count: 0 },
  aiMemory: {
    masteredVocabulary: [],
    frequentErrors: [],
    completedConcepts: [],
    currentDifficulties: [],
    lastLesson: "Introduction",
    weeklyGoal: "Découverte",
    successRate: 100,
    lastUpdate: Date.now()
  }
};

const App: React.FC = () => {
  return (
    <LanguageProvider>
      <AppContent />
    </LanguageProvider>
  );
};

const AppContent: React.FC = () => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [currentSession, setCurrentSession] = useState<LearningSession | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showVoiceCall, setShowVoiceCall] = useState(false); // State remonté
  const [verifyCertId, setVerifyCertId] = useState<string | null>(null); // Verification State
  
  // Modes
  const [activeMode, setActiveMode] = useState<'chat' | 'exercise' | 'practice' | 'exam'>('chat');
  const [currentExercises, setCurrentExercises] = useState<ExerciseItem[]>([]);
  const [isGeneratingExercise, setIsGeneratingExercise] = useState(false);

  const [isDarkMode, setIsDarkMode] = useState(() => localStorage.getItem('tm_theme') === 'dark');

  // Load User & Subscribe to Updates
  useEffect(() => {
    // Check URL for verification
    const path = window.location.pathname;
    if (path.startsWith('/verify/')) {
        const certId = path.split('/verify/')[1];
        if (certId) {
            setVerifyCertId(certId);
        }
    }

    const init = async () => {
        console.log("App initializing...");
        const curr = await storageService.getCurrentUser();
        if (curr) {
            setUser(curr);
            // AUTO-RESUME SESSION: Si l'utilisateur a déjà un cours en cours, on le reprend direct
            if (curr.preferences && curr.preferences.targetLanguage) {
                const session = await storageService.getOrCreateSession(curr.id, curr.preferences);
                setCurrentSession(session);
            }
        }
    };
    init();
    
    // Auth State Listener (Global Session Management)
    const { data: { subscription: authListener } } = supabase.auth.onAuthStateChange(async (event, session) => {
        console.log(`[Auth] State Change: ${event}`);
        
        if (event === 'SIGNED_OUT') {
            setUser(null);
            setCurrentSession(null);
            setShowDashboard(false);
            setShowAdmin(false);
            setActiveMode('chat');
            storageService.logout(); // Ensure local cleanup
        } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
            if (session?.user) {
                // Refresh user data on sign-in or token refresh
                const updated = await storageService.getUserById(session.user.id);
                if (updated) {
                    setUser(updated);
                    storageService.saveLocalUser(updated);
                }
            }
        }
    });
    
    // Global Event Listener for User Updates (Credits, Stats, etc.)
    const unsubscribeLocal = storageService.subscribeToUserUpdates((updatedUser) => {
        setUser((currentUser) => {
            // FIX: Sticky Preferences Protection
            if (currentUser && currentUser.id === updatedUser.id) {
                if (currentUser.preferences && (!updatedUser.preferences || !updatedUser.preferences.targetLanguage)) {
                    return { ...updatedUser, preferences: currentUser.preferences };
                }
            }
            return updatedUser;
        });
    });

    // Real-time Remote Subscription (Credits, XP, etc.)
    let unsubscribeRemote = () => {};
    if (user?.id) {
        unsubscribeRemote = (storageService as any).subscribeToRemoteChanges(user.id);
    }

    return () => {
        unsubscribeLocal();
        authListener.unsubscribe();
        unsubscribeRemote();
    };
  }, [user?.id]); // Dependency on user.id to re-subscribe when user changes

  // Theme logic
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
    localStorage.setItem('tm_theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  // Offline Detection
  useEffect(() => {
      const handleOffline = () => toast.error("Vous êtes hors ligne. Vérifiez votre connexion.");
      const handleOnline = () => toast.success("Connexion rétablie !");
      
      window.addEventListener('offline', handleOffline);
      window.addEventListener('online', handleOnline);
      
      return () => {
          window.removeEventListener('offline', handleOffline);
          window.removeEventListener('online', handleOnline);
      };
  }, []);

  // Refresh User Data on Focus
  useEffect(() => {
      const handleFocus = async () => {
          if (user) {
              const updated = await storageService.getUserById(user.id);
              if (updated) {
                  if (user.preferences && (!updated.preferences || !updated.preferences.targetLanguage)) {
                      return;
                  }
                  if (
                      updated.credits !== user.credits || 
                      updated.isSuspended !== user.isSuspended ||
                      JSON.stringify(updated.stats) !== JSON.stringify(user.stats)
                  ) {
                      setUser(updated);
                      if(updated.isSuspended) toast.info("Votre compte a été mis à jour.");
                  }
              }
          }
      };
      window.addEventListener('focus', handleFocus);
      return () => window.removeEventListener('focus', handleFocus);
  }, [user]);

  const notify = (msg: string, type: string = 'info') => {
    if (type === 'error') toast.error(msg);
    else if (type === 'success') toast.success(msg);
    else toast.info(msg);
  };

  const handleAuthSuccess = async (u: UserProfile) => {
    setUser(u);
    setShowAuth(false);
    if (u.preferences && u.preferences.targetLanguage) {
        const session = await storageService.getOrCreateSession(u.id, u.preferences);
        setCurrentSession(session);
    }
  };

  const handleChangeCourse = async () => {
      if (!user) return;
      const currentLang = user.preferences?.targetLanguage;
      const currentHistory = user.preferences?.history || {};
      if (currentLang) {
          currentHistory[currentLang] = user.stats;
      }
      const emptyStats: UserStats = { lessonsCompleted: 0, exercisesCompleted: 0, dialoguesCompleted: 0 };
      const updatedUser: UserProfile = {
          ...user,
          stats: emptyStats,
          preferences: {
              ...user.preferences!,
              targetLanguage: '', 
              level: '',
              history: currentHistory
          }
      };
      setUser(updatedUser);
      await storageService.saveUserProfile(updatedUser);
      setCurrentSession(null);
  };

  const handleOnboardingComplete = async (prefs: any) => {
    if (!user || !prefs) return;
    const selectedLang = prefs.targetLanguage || "English"; // Default fallback
    const history = user.preferences?.history || {};
    const restoredStats = history[selectedLang] || { 
        lessonsCompleted: 0, 
        exercisesCompleted: 0, 
        dialoguesCompleted: 0 
    };
    
    // Ensure preferences match UserPreferences type strictly
    const newPreferences: UserPreferences = {
        ...prefs,
        targetLanguage: selectedLang,
        history: history,
        // Ensure other required fields if any, or spread prefs
    };

    const updated: UserProfile = { 
        ...user, 
        stats: restoredStats,
        preferences: newPreferences
    };
    setUser(updated);
    await storageService.saveUserProfile(updated);
    const session = await storageService.getOrCreateSession(user.id, newPreferences);
    setCurrentSession(session);
  };

  const handleLogout = async () => {
    await storageService.logout();
    setUser(null);
    setCurrentSession(null);
    setShowDashboard(false);
    setShowAdmin(false);
    setActiveMode('chat');
  };

  const startExercise = async () => {
      if (!user || !currentSession) return;
      setIsGeneratingExercise(true);
      try {
          const exercises = await generateExerciseFromHistory(currentSession.messages, user);
          if (exercises.length > 0) {
              setCurrentExercises(exercises);
              setActiveMode('exercise');
          } else {
              toast.error("Impossible de générer des exercices (Contexte insuffisant ou erreur).");
          }
      } catch (e) {
          toast.error("Erreur lors de la génération.");
      } finally {
          setIsGeneratingExercise(false);
      }
  };

  const startExam = () => {
      setShowDashboard(false);
      setActiveMode('exam');
  };

  const finishExercise = async (score: number, total: number) => {
      if (user) {
          const newStats = {
              ...user.stats,
              exercisesCompleted: (user.stats.exercisesCompleted || 0) + 1
          };
          const currentLang = user.preferences?.targetLanguage;
          const currentHistory = user.preferences?.history || {};
          if (currentLang) {
              currentHistory[currentLang] = newStats;
          }
          const updatedUser = { 
              ...user, 
              stats: newStats,
              preferences: {
                  ...user.preferences!,
                  history: currentHistory
              }
          };
          await storageService.saveUserProfile(updatedUser);
          setUser(updatedUser);
          toast.success(`Exercice terminé ! Score : ${score}/${total}`);
      }
      setActiveMode('chat');
  };

  // Handlers pour le Dashboard
  const handleStartVoiceCall = () => {
      setShowDashboard(false);
      setShowVoiceCall(true);
  };

  const handleStartPractice = () => {
      setShowDashboard(false);
      setActiveMode('practice');
  };

  const handleStartExerciseFromDash = () => {
      setShowDashboard(false);
      startExercise();
  };

  const handleStartExamFromDash = () => {
      setShowDashboard(false);
      startExam();
  };

  const needsOnboarding = !user?.preferences || !user?.preferences?.targetLanguage;

  const getAgentContext = () => {
      if (!user) return "Page d'Accueil (Visiteur non connecté) - Présentation de TeacherMada";
      if (needsOnboarding) return "Configuration du Profil (Langue/Niveau)";
      if (showAdmin) return "Panneau Administrateur";
      if (showPayment) return "Rechargement de Crédits";
      if (showDashboard) return "Profil Utilisateur & Statistiques";
      if (activeMode === 'exercise') return "Session d'Exercices (Quiz)";
      if (activeMode === 'exam') return "Examen Final & Certification";
      if (activeMode === 'practice') return "Session de Dialogue (Roleplay)";
      if (showVoiceCall) return "Appel Vocal en Direct (TeacherMada Live)";
      return `Chat Principal - Apprentissage du ${user.preferences?.targetLanguage || 'Language'}`;
  };

  if (verifyCertId) {
      return (
          <div className="min-h-screen bg-slate-50 dark:bg-slate-950 font-sans transition-colors duration-300">
              <Toaster />
              <VerifyCertificate 
                  certId={verifyCertId} 
                  onClose={() => {
                      setVerifyCertId(null);
                      window.history.pushState({}, '', '/');
                  }} 
              />
          </div>
      );
  }

  if (showAdmin && user?.role === 'admin') {
      return (
          <div className="min-h-screen bg-slate-50 dark:bg-slate-950 font-sans transition-colors duration-300">
              <Toaster />
              <AdminDashboard 
                  currentUser={user}
                  onBack={() => setShowAdmin(false)}
                  onLogout={handleLogout}
                  isDarkMode={isDarkMode}
                  notify={notify}
              />
          </div>
      );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-50 font-sans transition-colors duration-300">
      <Toaster />
      <DebugConsole />

      {!showAdmin && (
          <TutorialAgent user={user || GUEST_USER} context={getAgentContext()} />
      )}

      {isGeneratingExercise && (
          <div className="fixed inset-0 z-[200] bg-slate-900/80 backdrop-blur-sm flex flex-col items-center justify-center text-white">
              <Loader2 className="w-12 h-12 animate-spin mb-4 text-indigo-500" />
              <p className="font-bold text-lg">Un prof prépare vos exercices...</p>
          </div>
      )}

      {/* Live Voice Call Overlay */}
      {showVoiceCall && user && (
          <LiveTeacher 
              user={user} 
              onClose={() => setShowVoiceCall(false)} 
              onUpdateUser={(updated) => {
                  setUser(prev => prev ? { ...updated, preferences: prev.preferences } : updated);
              }} 
              notify={notify}
              onShowPayment={() => setShowPayment(true)}
          />
      )}

      {!user && !showAuth && (
        <LandingPage onStart={() => setShowAuth(true)} isDarkMode={isDarkMode} toggleTheme={() => setIsDarkMode(!isDarkMode)} />
      )}

      {!user && showAuth && (
        <AuthScreen 
          onAuthSuccess={handleAuthSuccess} 
          onBack={() => setShowAuth(false)} 
          isDarkMode={isDarkMode} 
          toggleTheme={() => setIsDarkMode(!isDarkMode)} 
          notify={notify} 
        />
      )}

      {user && needsOnboarding && (
        <Onboarding 
          onComplete={handleOnboardingComplete} 
          isDarkMode={isDarkMode} 
          toggleTheme={() => setIsDarkMode(!isDarkMode)} 
        />
      )}

      {user && !needsOnboarding && currentSession && (
        <>
          {activeMode === 'chat' && !showVoiceCall && (
              <ChatInterface 
                user={user} 
                session={currentSession} 
                onShowProfile={() => setShowDashboard(true)}
                onExit={() => setCurrentSession(null)}
                onUpdateUser={(updated) => {
                    setUser(prev => prev ? { ...updated, preferences: prev.preferences } : updated);
                }}
                onStartPractice={() => setActiveMode('practice')}
                onStartExercise={startExercise}
                onStartExam={startExam}
                notify={notify}
                onShowPayment={() => setShowPayment(true)}
                onChangeCourse={handleChangeCourse}
                onStartVoiceCall={() => setShowVoiceCall(true)}
              />
          )}

          {activeMode === 'exercise' && (
              <ExerciseSession 
                  exercises={currentExercises}
                  onClose={() => setActiveMode('chat')}
                  onComplete={finishExercise}
              />
          )}

          {activeMode === 'exam' && (
              <React.Suspense fallback={
                  <div className="fixed inset-0 z-[200] bg-slate-900/80 backdrop-blur-sm flex flex-col items-center justify-center text-white">
                      <Loader2 className="w-12 h-12 animate-spin mb-4 text-indigo-500" />
                      <p className="font-bold text-lg">Chargement du module Examen...</p>
                  </div>
              }>
                  <ExamHub 
                      user={user}
                      onClose={() => setActiveMode('chat')}
                      onUpdateUser={setUser}
                      onShowPayment={() => setShowPayment(true)}
                  />
              </React.Suspense>
          )}

          {activeMode === 'practice' && (
              <DialogueSession 
                  user={user}
                  onClose={() => setActiveMode('chat')}
                  onUpdateUser={(updated) => {
                      setUser(prev => prev ? { ...updated, preferences: prev.preferences } : updated);
                  }}
                  notify={notify}
                  onShowPayment={() => setShowPayment(true)}
              />
          )}

          {showDashboard && (
            <SmartDashboard 
              user={user} 
              onClose={() => setShowDashboard(false)} 
              onUpdateUser={setUser} 
              onLogout={handleLogout}
              isDarkMode={isDarkMode} 
              toggleTheme={() => setIsDarkMode(!isDarkMode)}
              messages={currentSession.messages}
              onOpenAdmin={() => { setShowDashboard(false); setShowAdmin(true); }}
              onShowPayment={() => { setShowDashboard(false); setShowPayment(true); }}
              onStartPractice={handleStartPractice}
              onStartExercise={handleStartExerciseFromDash}
              onStartVoice={handleStartVoiceCall}
              onStartExam={handleStartExamFromDash}
            />
          )}

          {showPayment && (
              <PaymentModal 
                  user={user}
                  onClose={() => setShowPayment(false)}
              />
          )}
        </>
      )}

      {user && !needsOnboarding && !currentSession && !showAdmin && !showVoiceCall && (
        <div className="h-screen flex flex-col items-center justify-center p-6 bg-white dark:bg-slate-900 animate-fade-in">
           <div className="w-20 h-20 bg-indigo-600 rounded-[2rem] flex items-center justify-center text-white mb-8 shadow-2xl shadow-indigo-500/40">
             <img src="https://i.ibb.co/B2XmRwmJ/logo.png" className="w-12 h-12" />
           </div>
           <h1 className="text-2xl font-black mb-2">Bon retour, {user.username} !</h1>
           <p className="text-slate-500 mb-10 text-center">Prêt à continuer votre apprentissage du {user.preferences?.targetLanguage} ?</p>
           
           <div className="space-y-4 w-full max-w-sm">
             <button 
                onClick={async () => setCurrentSession(await storageService.getOrCreateSession(user.id, user.preferences!))}
                className="w-full py-5 bg-indigo-600 text-white font-black rounded-2xl shadow-xl shadow-indigo-500/20 hover:scale-[1.02] transition-all"
             >
               Reprendre mon cours
             </button>
             <button 
                onClick={handleChangeCourse}
                className="w-full py-4 text-slate-500 font-bold hover:text-indigo-600 transition-colors"
             >
               Changer de langue ou niveau
             </button>
             <button onClick={handleLogout} className="w-full py-2 text-red-500 text-sm font-bold">Déconnexion</button>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;