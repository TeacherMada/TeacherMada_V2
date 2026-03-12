import React, { useState, useEffect, useCallback } from 'react';
import LandingPage from './components/LandingPage';
import AuthScreen from './components/AuthScreen';
import Onboarding from './components/Onboarding';
//import ChatInterface from './components/ChatInterface';
import { ChatInterface } from "./components/ChatInterface";
import SmartDashboard from './components/SmartDashboard';
import ExerciseSession from './components/ExerciseSession';
import DialogueSession from './components/DialogueSession';
import PaymentModal from './components/PaymentModal';
import AdminDashboard from './components/AdminDashboard';
import TutorialAgent from './components/TutorialAgent';
import LiveTeacher from './components/LiveTeacher';
import VerifyCertificate from './components/VerifyCertificate';
import { UserProfile, LearningSession, ExerciseItem, LearningMode } from './types';
import type { UserPreferences } from './types';
import { storageService } from './services/storageService';
import { supabase } from './lib/supabase';
import { generateExerciseFromHistory } from './services/geminiService';
import { Toaster, toast } from './components/Toaster';
import { Loader2 } from 'lucide-react';
import DebugConsole from './components/DebugConsole';

// ── Lazy load des modules lourds ─────────────────────────────────────────────
const ExamHub = React.lazy(() => import('./modules/SmartExam'));

// ── Utilisateur invité pour le chatbot de la landing page ────────────────────
const GUEST_USER: UserProfile = {
  id: 'guest',
  username: 'Visiteur',
  role: 'user',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  credits: 0,
  preferences: {
    targetLanguage: 'Français',
    level: 'Débutant',
    explanationLanguage: 'Français',
    mode: LearningMode.Course,
    voiceName: 'Zephyr',
  },
};

// ── Préfixe des clés de session dans localStorage ────────────────────────────
const SESSION_PREFIX = 'tm_v3_session_';

// ============================================================================
const App: React.FC = () => <AppContent />;

const AppContent: React.FC = () => {

  // ── États principaux ───────────────────────────────────────────────────────
  const [user,           setUser]           = useState<UserProfile | null>(null);
  const [currentSession, setCurrentSession] = useState<LearningSession | null>(null);
  const [showAuth,       setShowAuth]       = useState(false);
  const [showDashboard,  setShowDashboard]  = useState(false);
  const [showPayment,    setShowPayment]    = useState(false);
  const [showAdmin,      setShowAdmin]      = useState(false);
  const [showVoiceCall,  setShowVoiceCall]  = useState(false);
  const [verifyCertId,   setVerifyCertId]   = useState<string | null>(null);

  // ── Modes d'apprentissage ──────────────────────────────────────────────────
  const [activeMode,           setActiveMode]           = useState<'chat' | 'exercise' | 'practice' | 'exam'>('chat');
  const [currentExercises,     setCurrentExercises]     = useState<ExerciseItem[]>([]);
  const [isGeneratingExercise, setIsGeneratingExercise] = useState(false);
  const [isResuming,           setIsResuming]           = useState(false);

  // ── Thème ──────────────────────────────────────────────────────────────────
  const [isDarkMode, setIsDarkMode] = useState(() => localStorage.getItem('tm_theme') === 'dark');

  // ══════════════════════════════════════════════════════════════════════════
  // 1. INITIALISATION & LISTENER AUTH
  // ══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    // Vérification URL pour la validation de certificat
    const path = window.location.pathname;
    if (path.startsWith('/verify/')) {
      const certId = path.split('/verify/')[1];
      if (certId) setVerifyCertId(certId);
    }

    // Chargement optimiste (local-first) puis sync distant
    const init = async () => {
      // 1a. Charger l'utilisateur local immédiatement (évite le flash de la landing)
      const localUser = storageService.getLocalUser();
      if (localUser) {
        setUser(localUser);
        if (localUser.preferences?.targetLanguage) {
          const localSession = await storageService.getOrCreateSession(localUser.id, localUser.preferences);
          setCurrentSession(localSession);
        }
      }

      // 1b. Synchronisation distante en arrière-plan
      const curr = await storageService.getCurrentUser();
      if (curr) {
        setUser(curr);
        if (curr.preferences?.targetLanguage) {
          const session = await storageService.getOrCreateSession(curr.id, curr.preferences);
          setCurrentSession(session);
        }
      }
    };
    init();

    // ── Listener Supabase Auth ─────────────────────────────────────────────
    const { data: { subscription: authListener } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_OUT') {
          // ✅ FIX: Nettoyer uniquement les données d'auth, PAS les sessions (historique préservé)
          setUser(null);
          setCurrentSession(null);
          setShowDashboard(false);
          setShowAdmin(false);
          setActiveMode('chat');
          localStorage.removeItem('teachermada_user_data');
          localStorage.removeItem('tm_v3_current_user_id');

        } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          if (session?.user) {
            const updated = await storageService.getUserById(session.user.id);
            if (updated) {
              setUser(updated);
              storageService.saveLocalUser(updated);
            }
          }
        }
      }
    );

    return () => {
      authListener.unsubscribe();
    };
  }, []);

  // ══════════════════════════════════════════════════════════════════════════
  // 2. SUBSCRIPTIONS TEMPS RÉEL
  // ══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!user?.id) return;

    // Mises à jour locales (autres composants / onglets)
    const unsubscribeLocal = storageService.subscribeToUserUpdates((updatedUser) => {
      setUser((currentUser) => {
        // Protection des préférences : ne jamais les écraser par une valeur vide
        if (currentUser?.id === updatedUser.id) {
          if (currentUser.preferences && (!updatedUser.preferences || !updatedUser.preferences.targetLanguage)) {
            return { ...updatedUser, preferences: currentUser.preferences };
          }
        }
        return updatedUser;
      });
    });

    // Mises à jour distantes (Supabase Realtime — crédits, suspension)
    const unsubscribeRemote = storageService.subscribeToRemoteChanges(user.id);

    // ✅ NOUVEAU: Écouter les mises à jour de session depuis le background sync
    const handleSessionUpdate = (event: Event) => {
      const customEvent = event as CustomEvent<LearningSession>;
      if (customEvent.detail) {
        setCurrentSession(prev => {
          // Mettre à jour seulement si c'est la session active
          if (prev?.id === customEvent.detail.id) {
            return customEvent.detail;
          }
          return prev;
        });
      }
    };
    window.addEventListener('tm_session_updated', handleSessionUpdate);

    return () => {
      unsubscribeLocal();
      unsubscribeRemote();
      window.removeEventListener('tm_session_updated', handleSessionUpdate);
    };
  }, [user?.id]);

  // ══════════════════════════════════════════════════════════════════════════
  // 3. THÈME & ÉVÉNEMENTS RÉSEAU
  // ══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
    localStorage.setItem('tm_theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  useEffect(() => {
    const handleOffline = () => toast.error("Vous êtes hors ligne. Vérifiez votre connexion.");
    const handleOnline  = () => toast.success("Connexion rétablie !");

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online',  handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online',  handleOnline);
    };
  }, []);

  // ══════════════════════════════════════════════════════════════════════════
  // 4. REFRESH AU FOCUS (crédits & statut suspension)
  // ══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    const handleFocus = async () => {
      if (!user) return;
      try {
        const updated = await storageService.getUserById(user.id);
        if (updated && (
          updated.credits     !== user.credits ||
          updated.isSuspended !== user.isSuspended
        )) {
          setUser(prev => prev ? { ...updated, preferences: prev.preferences } : updated);
          if (updated.isSuspended) toast.info("Votre compte a été mis à jour par l'administrateur.");
        }
      } catch { /* offline, ignoré */ }
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [user?.id, user?.credits, user?.isSuspended]);

  // ══════════════════════════════════════════════════════════════════════════
  // 5. SAUVEGARDE AU DÉCHARGEMENT DE LA PAGE
  // ══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (user) {
        // Mémoriser la dernière visite pour analytics / reprise de cours
        localStorage.setItem(`tm_last_used_${user.id}`, Date.now().toString());
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [user]);

  // ══════════════════════════════════════════════════════════════════════════
  // HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  const notify = useCallback((msg: string, type: string = 'info') => {
    if (type === 'error')   toast.error(msg);
    else if (type === 'success') toast.success(msg);
    else toast.info(msg);
  }, []);

  // ── Connexion réussie ──────────────────────────────────────────────────────
  const handleAuthSuccess = async (u: UserProfile) => {
    setUser(u);
    setShowAuth(false);
    if (u.preferences?.targetLanguage) {
      const session = await storageService.getOrCreateSession(u.id, u.preferences);
      setCurrentSession(session);
    }
  };

  // ── Déconnexion ────────────────────────────────────────────────────────────
  // ✅ FIX COMPLET: stable, préserve les sessions (historique conservé)
  const handleLogout = async () => {
    try {
      // 1. Déconnexion Supabase (scope 'local' = ne déconnecte pas les autres onglets)
      await supabase.auth.signOut({ scope: 'local' }).catch(e => {
        console.warn('[Logout] Supabase signOut error (ignoré):', e);
      });

      // 2. Nettoyer localStorage — PRÉSERVER les sessions (historique) et le thème
      Object.keys(localStorage).forEach(key => {
        const isSession = key.startsWith(SESSION_PREFIX);
        const isTheme   = key === 'tm_theme';
        // Supprimer uniquement les clés tm_* qui ne sont ni session ni thème
        if (key.startsWith('tm_') && !isSession && !isTheme) {
          localStorage.removeItem(key);
        }
      });

      // 3. Réinitialiser tous les états React
      setUser(null);
      setCurrentSession(null);
      setShowDashboard(false);
      setShowAdmin(false);
      setShowAuth(false);
      setShowPayment(false);
      setShowVoiceCall(false);
      setVerifyCertId(null);
      setActiveMode('chat');
      setCurrentExercises([]);
      setIsGeneratingExercise(false);

      toast.success('Déconnexion réussie.');

    } catch (error: any) {
      console.error('[Logout] Erreur critique:', error);
      // Forcer la déconnexion même en cas d'erreur
      setUser(null);
      setCurrentSession(null);
      toast.error('Erreur lors de la déconnexion.');
    }
  };

  // ── Changer de cours ───────────────────────────────────────────────────────
  const handleChangeCourse = async () => {
    if (!user) return;
    const updatedUser: UserProfile = {
      ...user,
      preferences: {
        ...user.preferences!,
        targetLanguage: '',
        level: '',
      },
    };
    setUser(updatedUser);
    await storageService.saveUserProfile(updatedUser);
    setCurrentSession(null);
  };

  // ── Onboarding terminé ─────────────────────────────────────────────────────
  const handleOnboardingComplete = async (prefs: any) => {
    if (!user || !prefs) return;

    const newPreferences: UserPreferences = {
      ...prefs,
      targetLanguage: prefs.targetLanguage || 'English',
    };

    const updated: UserProfile = { ...user, preferences: newPreferences };
    setUser(updated);
    await storageService.saveUserProfile(updated);
    const session = await storageService.getOrCreateSession(user.id, newPreferences);
    setCurrentSession(session);
  };

  // ── Reprendre le cours ─────────────────────────────────────────────────────
  const handleResumeCourse = async () => {
    if (!user?.preferences || isResuming) return;
    setIsResuming(true);
    try {
      const session = await storageService.getOrCreateSession(user.id, user.preferences);
      if (session?.id) {
        setCurrentSession(session);
        toast.success('Cours repris avec succès !');
      } else {
        throw new Error('Session invalide');
      }
    } catch {
      toast.error('Impossible de reprendre le cours. Vérifiez votre connexion.');
    } finally {
      setIsResuming(false);
    }
  };

  // ── Génération d'exercices ─────────────────────────────────────────────────
  const startExercise = async () => {
    if (!user || !currentSession) return;
    setIsGeneratingExercise(true);
    try {
      const exercises = await generateExerciseFromHistory(currentSession.messages, user);
      if (exercises.length > 0) {
        setCurrentExercises(exercises);
        setActiveMode('exercise');
      } else {
        toast.error('Impossible de générer des exercices (contexte insuffisant).');
      }
    } catch {
      toast.error('Erreur lors de la génération des exercices.');
    } finally {
      setIsGeneratingExercise(false);
    }
  };

  const startExam = () => {
    setShowDashboard(false);
    setActiveMode('exam');
  };

  const finishExercise = async (score: number, total: number) => {
    toast.success(`Exercice terminé ! Score : ${score}/${total}`);
    setActiveMode('chat');
  };

  // ── Handlers du Dashboard ──────────────────────────────────────────────────
  const handleStartVoiceCall = ()           => { setShowDashboard(false); setShowVoiceCall(true); };
  const handleStartPractice  = ()           => { setShowDashboard(false); setActiveMode('practice'); };
  const handleStartExerciseFromDash = ()    => { setShowDashboard(false); startExercise(); };
  const handleStartExamFromDash     = ()    => { setShowDashboard(false); startExam(); };

  // ── Mise à jour utilisateur (préserve les préférences) ────────────────────
  const handleUpdateUser = useCallback((updated: UserProfile) => {
    setUser(prev => prev ? { ...updated, preferences: prev.preferences || updated.preferences } : updated);
  }, []);

  // ── Contexte pour l'agent tutoriel ────────────────────────────────────────
  const getAgentContext = (): string => {
    if (!user)              return "Page d'Accueil (Visiteur non connecté) - Présentation de TeacherMada";
    if (!user.preferences?.targetLanguage) return "Configuration du Profil (Langue/Niveau)";
    if (showAdmin)          return "Panneau Administrateur";
    if (showPayment)        return "Rechargement de Crédits";
    if (showDashboard)      return "Profil Utilisateur & Statistiques";
    if (activeMode === 'exercise') return "Session d'Exercices (Quiz)";
    if (activeMode === 'exam')     return "Examen Final & Certification";
    if (activeMode === 'practice') return "Session de Dialogue (Roleplay)";
    if (showVoiceCall)      return "Appel Vocal en Direct (TeacherMada Live)";
    return `Chat Principal - Apprentissage du ${user.preferences?.targetLanguage || 'Language'}`;
  };

  const needsOnboarding = !user?.preferences?.targetLanguage;

  // ══════════════════════════════════════════════════════════════════════════
  // RENDU
  // ══════════════════════════════════════════════════════════════════════════

  // ── Vérification de certificat (route /verify/:id) ────────────────────────
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

  // ── Dashboard Admin ────────────────────────────────────────────────────────
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

  // ── Application principale ────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-50 font-sans transition-colors duration-300">
      <Toaster />
      <DebugConsole />

      {/* Agent tutoriel (hors admin) */}
      {!showAdmin && (
        <TutorialAgent user={user || GUEST_USER} context={getAgentContext()} />
      )}

      {/* Overlay de génération d'exercices */}
      {isGeneratingExercise && (
        <div className="fixed inset-0 z-[200] bg-slate-900/80 backdrop-blur-sm flex flex-col items-center justify-center text-white">
          <Loader2 className="w-12 h-12 animate-spin mb-4 text-indigo-500" />
          <p className="font-bold text-lg">Un prof prépare vos exercices...</p>
        </div>
      )}

      {/* Appel vocal en superposition */}
      {showVoiceCall && user && (
        <LiveTeacher
          user={user}
          onClose={() => setShowVoiceCall(false)}
          onUpdateUser={handleUpdateUser}
          notify={notify}
          onShowPayment={() => setShowPayment(true)}
        />
      )}

      {/* ── LANDING PAGE (non connecté) ── */}
      {!user && !showAuth && (
        <LandingPage
          onStart={() => setShowAuth(true)}
          isDarkMode={isDarkMode}
          toggleTheme={() => setIsDarkMode(d => !d)}
        />
      )}

      {/* ── ÉCRAN D'AUTHENTIFICATION ── */}
      {!user && showAuth && (
        <AuthScreen
          onAuthSuccess={handleAuthSuccess}
          onBack={() => setShowAuth(false)}
          isDarkMode={isDarkMode}
          toggleTheme={() => setIsDarkMode(d => !d)}
          notify={notify}
        />
      )}

      {/* ── ONBOARDING (connecté mais pas de préférences) ── */}
      {user && needsOnboarding && (
        <Onboarding
          onComplete={handleOnboardingComplete}
          isDarkMode={isDarkMode}
          toggleTheme={() => setIsDarkMode(d => !d)}
        />
      )}

      {/* ── APPLICATION PRINCIPALE (connecté + préférences définies + session) ── */}
      {user && !needsOnboarding && currentSession && (
        <>
          {/* Chat principal */}
          {activeMode === 'chat' && !showVoiceCall && (
            <ChatInterface
              user={user}
              session={currentSession}
              onShowProfile={() => setShowDashboard(true)}
              onExit={() => setCurrentSession(null)}
              onUpdateUser={handleUpdateUser}
              onStartPractice={() => setActiveMode('practice')}
              onStartExercise={startExercise}
              onStartExam={startExam}
              notify={notify}
              onShowPayment={() => setShowPayment(true)}
              onChangeCourse={handleChangeCourse}
              onStartVoiceCall={() => setShowVoiceCall(true)}
            />
          )}

          {/* Session d'exercices */}
          {activeMode === 'exercise' && (
            <ExerciseSession
              exercises={currentExercises}
              onClose={() => setActiveMode('chat')}
              onComplete={finishExercise}
            />
          )}

          {/* Examen (lazy loaded) */}
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

          {/* Session de dialogue (roleplay) */}
          {activeMode === 'practice' && (
            <DialogueSession
              user={user}
              onClose={() => setActiveMode('chat')}
              onUpdateUser={handleUpdateUser}
              notify={notify}
              onShowPayment={() => setShowPayment(true)}
            />
          )}

          {/* Dashboard utilisateur */}
          {showDashboard && (
            <SmartDashboard
              user={user}
              onClose={() => setShowDashboard(false)}
              onUpdateUser={setUser}
              onLogout={handleLogout}
              isDarkMode={isDarkMode}
              toggleTheme={() => setIsDarkMode(d => !d)}
              messages={currentSession.messages}
              onOpenAdmin={() => { setShowDashboard(false); setShowAdmin(true); }}
              onShowPayment={() => { setShowDashboard(false); setShowPayment(true); }}
              onStartPractice={handleStartPractice}
              onStartExercise={handleStartExerciseFromDash}
              onStartVoice={handleStartVoiceCall}
              onStartExam={handleStartExamFromDash}
            />
          )}

          {/* Modal de paiement */}
          {showPayment && (
            <PaymentModal
              user={user}
              onClose={() => setShowPayment(false)}
            />
          )}
        </>
      )}

      {/* ── ÉCRAN DE REPRISE (connecté + prefs + pas de session) ── */}
      {user && !needsOnboarding && !currentSession && !showAdmin && !showVoiceCall && (
        <div className="h-screen flex flex-col items-center justify-center p-6 bg-white dark:bg-slate-900 animate-fade-in">
          <div className="w-20 h-20 bg-indigo-600 rounded-[2rem] flex items-center justify-center text-white mb-8 shadow-2xl shadow-indigo-500/40">
            <img
              src="https://i.ibb.co/B2XmRwmJ/logo.png"
              alt="Logo TeacherMada"
              className="w-12 h-12 object-contain"
            />
          </div>

          <h1 className="text-2xl font-black mb-2 text-slate-900 dark:text-white">
            Bon retour, {user.username} !
          </h1>
          <p className="text-slate-500 dark:text-slate-400 mb-10 text-center">
            Prêt à continuer votre apprentissage du{' '}
            <span className="font-bold text-indigo-600 dark:text-indigo-400">
              {user.preferences?.targetLanguage}
            </span> ?
          </p>

          <div className="space-y-3 w-full max-w-sm">
            <button
              onClick={handleResumeCourse}
              disabled={isResuming}
              className="w-full py-5 bg-indigo-600 hover:bg-indigo-700 text-white font-black rounded-2xl shadow-xl shadow-indigo-500/20 hover:scale-[1.02] transition-all disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isResuming ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Reprise en cours...
                </>
              ) : (
                '▶ Reprendre mon cours'
              )}
            </button>

            <button
              onClick={handleChangeCourse}
              className="w-full py-4 text-slate-500 dark:text-slate-400 font-bold hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              Changer de langue ou niveau
            </button>

            {/* Bouton admin visible uniquement pour les admins */}
            {user.role === 'admin' && (
              <button
                onClick={() => setShowAdmin(true)}
                className="w-full py-3 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 font-bold rounded-2xl hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors text-sm"
              >
                ⚙️ Panneau Admin
              </button>
            )}

            <button
              onClick={handleLogout}
              className="w-full py-2 text-red-500 hover:text-red-600 text-sm font-bold transition-colors"
            >
              Déconnexion
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
