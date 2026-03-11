// ============================================================================
// APP.TSX - VERSION OPTIMISÉE PRODUCTION-READY
// ============================================================================
// Modifications :
// - Lazy loading de TOUS les composants lourds
// - Suspense avec fallback élégant
// - ErrorBoundary pour capturer les erreurs
// - Performance optimisée
// ============================================================================

import React, { useState, useEffect, lazy, Suspense } from 'react';
import { UserProfile, LearningSession, ExerciseItem, LearningMode } from './types';
import type { UserPreferences } from './types';
import { storageService } from './services/storageService';
import { supabase } from './lib/supabase';
import { generateExerciseFromHistory } from './services/geminiService';
import { Toaster, toast } from './components/Toaster';
import { Loader2 } from 'lucide-react';

// ============================================================================
// LAZY LOADING - Tous les composants lourds
// ============================================================================

// Composants de base (lazy loaded)
const LandingPage = lazy(() => import('./components/LandingPage'));
const AuthScreen = lazy(() => import('./components/AuthScreen'));
const Onboarding = lazy(() => import('./components/Onboarding'));

// Composants principaux (lazy loaded)
const ChatInterface = lazy(() => import('./components/ChatInterface'));
const SmartDashboard = lazy(() => import('./components/SmartDashboard'));
const ExerciseSession = lazy(() => import('./components/ExerciseSession'));
const DialogueSession = lazy(() => import('./components/DialogueSession'));
const PaymentModal = lazy(() => import('./components/PaymentModal'));
const AdminDashboard = lazy(() => import('./components/AdminDashboard'));

// Composants auxiliaires (lazy loaded)
const TutorialAgent = lazy(() => import('./components/TutorialAgent'));
const LiveTeacher = lazy(() => import('./components/LiveTeacher'));
const VerifyCertificate = lazy(() => import('./components/VerifyCertificate'));
const DebugConsole = lazy(() => import('./components/DebugConsole'));

// Modules (lazy loaded)
const ExamHub = lazy(() => import('./modules/SmartExam'));

// ============================================================================
// LOADING FALLBACK - Écran de chargement élégant
// ============================================================================

const LoadingFallback = ({ message = 'Chargement...' }: { message?: string }) => (
  <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500">
    <div className="text-center">
      <Loader2 className="w-16 h-16 text-white animate-spin mx-auto mb-4" />
      <p className="text-white text-lg font-medium">{message}</p>
      <p className="text-white/80 text-sm mt-2">Veuillez patienter...</p>
    </div>
  </div>
);

// ============================================================================
// ERROR BOUNDARY - Capturer les erreurs React
// ============================================================================

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Erreur capturée:', error, errorInfo);
    
    // Logger l'erreur (si errorService disponible)
    if (window.errorService) {
      window.errorService.logError(error, {
        context: 'AppErrorBoundary',
        severity: 'critical',
        metadata: { componentStack: errorInfo.componentStack },
      });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-red-50">
          <div className="max-w-md p-8 bg-white rounded-lg shadow-xl">
            <div className="text-red-600 text-6xl mb-4">⚠️</div>
            <h1 className="text-2xl font-bold text-gray-900 mb-4">
              Une erreur est survenue
            </h1>
            <p className="text-gray-600 mb-6">
              L'application a rencontré un problème inattendu.
            </p>
            <details className="mb-6">
              <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-700">
                Détails techniques
              </summary>
              <pre className="mt-2 p-4 bg-gray-100 rounded text-xs overflow-auto">
                {this.state.error?.toString()}
              </pre>
            </details>
            <button
              onClick={() => window.location.reload()}
              className="w-full px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition"
            >
              Recharger la page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// ============================================================================
// MOCK GUEST USER
// ============================================================================

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
    voiceName: 'Zephyr'
  }
};

// ============================================================================
// APP COMPONENT
// ============================================================================

const App: React.FC = () => {
  return (
    <AppErrorBoundary>
      <Suspense fallback={<LoadingFallback message="Initialisation de l'application..." />}>
        <AppContent />
      </Suspense>
    </AppErrorBoundary>
  );
};

// ============================================================================
// APP CONTENT - Logique principale
// ============================================================================

const AppContent: React.FC = () => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [currentSession, setCurrentSession] = useState<LearningSession | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showVoiceCall, setShowVoiceCall] = useState(false);
  const [verifyCertId, setVerifyCertId] = useState<string | null>(null);
  
  // Modes
  const [activeMode, setActiveMode] = useState<'chat' | 'exercise' | 'practice' | 'exam'>('chat');
  const [currentExercises, setCurrentExercises] = useState<ExerciseItem[]>([]);
  const [isGeneratingExercise, setIsGeneratingExercise] = useState(false);
  const [isResuming, setIsResuming] = useState(false);

  const [isDarkMode, setIsDarkMode] = useState(() => localStorage.getItem('tm_theme') === 'dark');

  // ============================================================================
  // 1. INITIALIZATION & AUTH LISTENER
  // ============================================================================

  useEffect(() => {
    // Check URL for verification
    const path = window.location.pathname;
    if (path.startsWith('/verify/')) {
      const certId = path.split('/verify/')[1];
      if (certId) setVerifyCertId(certId);
    }

    const init = async () => {
      try {
        // Optimistic load from localStorage
        const localUser = storageService.getLocalUser();
        if (localUser) {
          setUser(localUser);
          if (localUser.preferences?.targetLanguage) {
            const localSession = await storageService.getOrCreateSession(
              localUser.id,
              localUser.preferences
            );
            setCurrentSession(localSession);
          }
        }

        // Remote fetch (background)
        const curr = await storageService.getCurrentUser();
        if (curr) {
          setUser(curr);
          if (curr.preferences?.targetLanguage) {
            const session = await storageService.getOrCreateSession(
              curr.id,
              curr.preferences
            );
            setCurrentSession(session);
          }
        }
      } catch (error) {
        console.error('[App] Erreur initialisation:', error);
        toast.error('Erreur de chargement. Vérifiez votre connexion.');
      }
    };

    init();

    // Supabase Auth Listener
    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('[App] Auth event:', event);
        
        if (event === 'SIGNED_OUT') {
          setUser(null);
          setCurrentSession(null);
          setShowAuth(false);
          setShowDashboard(false);
          setShowAdmin(false);
        }
        
        if (event === 'SIGNED_IN' && session?.user) {
          try {
            const profile = await storageService.getUserProfile(session.user.id);
            if (profile) {
              setUser(profile);
              toast.success(`✅ Bienvenue ${profile.username} !`);
            }
          } catch (error) {
            console.error('[App] Erreur chargement profil:', error);
          }
        }
      }
    );

    // Cleanup
    return () => {
      authListener?.subscription?.unsubscribe();
    };
  }, []);

  // ============================================================================
  // 2. REALTIME UPDATES SUBSCRIPTION
  // ============================================================================

  useEffect(() => {
    if (!user?.id) return;

    const unsubscribe = storageService.subscribeToRemoteChanges(user.id);
    return () => unsubscribe();
  }, [user?.id]);

  // ============================================================================
  // 3. DARK MODE TOGGLE
  // ============================================================================

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('tm_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('tm_theme', 'light');
    }
  }, [isDarkMode]);

  // ============================================================================
  // HANDLERS
  // ============================================================================

  const handleLoginSuccess = async (profile: UserProfile) => {
    setUser(profile);
    setShowAuth(false);

    if (profile.preferences?.targetLanguage) {
      const session = await storageService.getOrCreateSession(
        profile.id,
        profile.preferences
      );
      setCurrentSession(session);
    }
  };

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      setUser(null);
      setCurrentSession(null);
      setShowDashboard(false);
      setShowAdmin(false);
      toast.success('Déconnexion réussie');
    } catch (error) {
      console.error('[App] Erreur déconnexion:', error);
      toast.error('Erreur lors de la déconnexion');
    }
  };

  const handleOnboardingComplete = async (prefs: UserPreferences) => {
    if (!user) return;

    try {
      await storageService.updateProfile(user.id, { preferences: prefs });
      const updated = await storageService.getUserProfile(user.id);
      if (updated) {
        setUser(updated);
        const session = await storageService.getOrCreateSession(updated.id, prefs);
        setCurrentSession(session);
      }
    } catch (error) {
      console.error('[App] Erreur onboarding:', error);
      toast.error('Erreur de configuration');
    }
  };

  const handleUpdateSession = async (session: LearningSession) => {
    setCurrentSession(session);
    if (user?.id) {
      await storageService.updateSession(user.id, session);
    }
  };

  const handleGenerateExercise = async () => {
    if (!user || !currentSession?.chatHistory) return;

    setIsGeneratingExercise(true);
    try {
      const exercises = await generateExerciseFromHistory(
        currentSession.chatHistory,
        user
      );
      
      if (exercises.length > 0) {
        setCurrentExercises(exercises);
        setActiveMode('exercise');
        toast.success(`✨ ${exercises.length} exercices générés !`);
      } else {
        toast.error('Impossible de générer des exercices. Continuez la conversation.');
      }
    } catch (error) {
      console.error('[App] Erreur génération exercices:', error);
      toast.error('Erreur lors de la génération des exercices');
    } finally {
      setIsGeneratingExercise(false);
    }
  };

  // ============================================================================
  // RENDER - Avec Suspense pour chaque composant lazy
  // ============================================================================

  // Certificate Verification Mode
  if (verifyCertId) {
    return (
      <Suspense fallback={<LoadingFallback message="Vérification du certificat..." />}>
        <VerifyCertificate
          certId={verifyCertId}
          onClose={() => {
            setVerifyCertId(null);
            window.history.pushState({}, '', '/');
          }}
        />
      </Suspense>
    );
  }

  // Admin Dashboard
  if (showAdmin && user?.role === 'admin') {
    return (
      <Suspense fallback={<LoadingFallback message="Chargement du panneau admin..." />}>
        <AdminDashboard onClose={() => setShowAdmin(false)} />
        <Toaster />
      </Suspense>
    );
  }

  // Auth Screen
  if (showAuth) {
    return (
      <Suspense fallback={<LoadingFallback message="Chargement de l'authentification..." />}>
        <AuthScreen
          onLoginSuccess={handleLoginSuccess}
          onClose={() => setShowAuth(false)}
        />
        <Toaster />
      </Suspense>
    );
  }

  // Landing Page (no user logged in)
  if (!user || user.id === 'guest') {
    return (
      <Suspense fallback={<LoadingFallback message="Chargement de la page d'accueil..." />}>
        <LandingPage
          onLogin={() => setShowAuth(true)}
          guestUser={GUEST_USER}
          isDarkMode={isDarkMode}
          toggleDarkMode={() => setIsDarkMode(!isDarkMode)}
        />
        <Toaster />
      </Suspense>
    );
  }

  // Onboarding (user without preferences)
  if (!user.preferences?.targetLanguage) {
    return (
      <Suspense fallback={<LoadingFallback message="Configuration de votre profil..." />}>
        <Onboarding
          user={user}
          onComplete={handleOnboardingComplete}
          onLogout={handleLogout}
        />
        <Toaster />
      </Suspense>
    );
  }

  // Main Application
  return (
    <div className="relative min-h-screen bg-gray-50 dark:bg-gray-900">
      <Suspense fallback={<LoadingFallback message="Chargement de l'interface..." />}>
        {/* Dashboard Modal */}
        {showDashboard && (
          <SmartDashboard
            user={user}
            onClose={() => setShowDashboard(false)}
            onUpdateUser={setUser}
            onOpenPayment={() => setShowPayment(true)}
          />
        )}

        {/* Payment Modal */}
        {showPayment && (
          <PaymentModal
            user={user}
            onClose={() => setShowPayment(false)}
            onSuccess={(newCredits) => {
              setUser({ ...user, credits: newCredits });
              setShowPayment(false);
            }}
          />
        )}

        {/* Voice Call */}
        {showVoiceCall && user.preferences && (
          <LiveTeacher
            user={user}
            preferences={user.preferences}
            onClose={() => setShowVoiceCall(false)}
            onUpdateUser={setUser}
          />
        )}

        {/* Main Content - Modes */}
        {activeMode === 'chat' && currentSession && (
          <ChatInterface
            user={user}
            session={currentSession}
            onUpdateSession={handleUpdateSession}
            onOpenDashboard={() => setShowDashboard(true)}
            onLogout={handleLogout}
            onGenerateExercise={handleGenerateExercise}
            onOpenAdmin={user.role === 'admin' ? () => setShowAdmin(true) : undefined}
            isGeneratingExercise={isGeneratingExercise}
            onOpenVoiceCall={() => setShowVoiceCall(true)}
            onChangeMode={(mode) => setActiveMode(mode)}
          />
        )}

        {activeMode === 'exercise' && (
          <ExerciseSession
            exercises={currentExercises}
            user={user}
            onBack={() => setActiveMode('chat')}
          />
        )}

        {activeMode === 'practice' && user.preferences && (
          <DialogueSession
            user={user}
            preferences={user.preferences}
            onBack={() => setActiveMode('chat')}
            onUpdateUser={setUser}
          />
        )}

        {activeMode === 'exam' && (
          <ExamHub
            user={user}
            onClose={() => setActiveMode('chat')}
            onUpdateUser={setUser}
          />
        )}

        {/* Tutorial Agent */}
        {user.preferences && (
          <TutorialAgent
            user={user}
            preferences={user.preferences}
          />
        )}

        {/* Debug Console (dev mode) */}
        {import.meta.env.DEV && <DebugConsole />}

        <Toaster />
      </Suspense>
    </div>
  );
};

// ============================================================================
// EXPORTS
// ============================================================================

export default App;

// Déclaration globale pour errorService
declare global {
  interface Window {
    errorService?: any;
  }
}
