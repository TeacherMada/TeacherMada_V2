// ============================================================================
// APP.TSX - VERSION OPTIMISÉE PRODUCTION READY (FIXED)
// ============================================================================

import React, { useState, useEffect, lazy, Suspense } from 'react'
import { UserProfile, LearningSession, ExerciseItem, LearningMode } from './types'
import type { UserPreferences } from './types'
import { storageService } from './services/storageService'
import { supabase } from './lib/supabase'
import { generateExerciseFromHistory } from './services/geminiService'
import { Toaster, toast } from './components/Toaster'
import { Loader2 } from 'lucide-react'

// ============================================================================
// LAZY LOADING
// ============================================================================

const LandingPage = lazy(() => import('./components/LandingPage'))
const AuthScreen = lazy(() => import('./components/AuthScreen'))
const Onboarding = lazy(() => import('./components/Onboarding'))

const ChatInterface = lazy(() => import('./components/ChatInterface'))
const SmartDashboard = lazy(() => import('./components/SmartDashboard'))
const ExerciseSession = lazy(() => import('./components/ExerciseSession'))
const DialogueSession = lazy(() => import('./components/DialogueSession'))
const PaymentModal = lazy(() => import('./components/PaymentModal'))
const AdminDashboard = lazy(() => import('./components/AdminDashboard'))

const TutorialAgent = lazy(() => import('./components/TutorialAgent'))
const LiveTeacher = lazy(() => import('./components/LiveTeacher'))
const VerifyCertificate = lazy(() => import('./components/VerifyCertificate'))
const DebugConsole = lazy(() => import('./components/DebugConsole'))

const ExamHub = lazy(() => import('./modules/SmartExam'))

// ============================================================================
// LOADING SCREEN
// ============================================================================

const LoadingFallback = ({ message = 'Chargement...' }: { message?: string }) => (
  <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500">
    <div className="text-center">
      <Loader2 className="w-16 h-16 text-white animate-spin mx-auto mb-4" />
      <p className="text-white text-lg font-medium">{message}</p>
      <p className="text-white/80 text-sm mt-2">Veuillez patienter...</p>
    </div>
  </div>
)

// ============================================================================
// ERROR BOUNDARY
// ============================================================================

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: any) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-red-50">
          <div className="max-w-md p-8 bg-white rounded-lg shadow-xl">
            <h1 className="text-xl font-bold mb-4">Erreur application</h1>
            <pre className="text-xs">{this.state.error?.message}</pre>
            <button
              onClick={() => window.location.reload()}
              className="mt-6 px-4 py-2 bg-indigo-600 text-white rounded"
            >
              Recharger
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

// ============================================================================
// GUEST USER
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
}

// ============================================================================
// APP ROOT
// ============================================================================

const App: React.FC = () => {
  return (
    <AppErrorBoundary>
      <Suspense fallback={<LoadingFallback message="Initialisation..." />}>
        <AppContent />
      </Suspense>
    </AppErrorBoundary>
  )
}

// ============================================================================
// MAIN APP
// ============================================================================

const AppContent: React.FC = () => {

  const [user, setUser] = useState<UserProfile | null>(null)
  const [currentSession, setCurrentSession] = useState<LearningSession | null>(null)

  const [showAuth, setShowAuth] = useState(false)
  const [showDashboard, setShowDashboard] = useState(false)
  const [showPayment, setShowPayment] = useState(false)
  const [showAdmin, setShowAdmin] = useState(false)
  const [showVoiceCall, setShowVoiceCall] = useState(false)

  const [verifyCertId, setVerifyCertId] = useState<string | null>(null)

  const [activeMode, setActiveMode] = useState<'chat' | 'exercise' | 'practice' | 'exam'>('chat')

  const [currentExercises, setCurrentExercises] = useState<ExerciseItem[]>([])
  const [isGeneratingExercise, setIsGeneratingExercise] = useState(false)

  const [isDarkMode, setIsDarkMode] = useState(
    () => localStorage.getItem('tm_theme') === 'dark'
  )

  // ============================================================================
  // INIT
  // ============================================================================

  useEffect(() => {

    const init = async () => {

      try {

        const localUser = storageService.getLocalUser?.()

        if (localUser) {
          setUser(localUser)

          if (localUser.preferences) {

            const session = await storageService.getOrCreateSession(
              localUser.id,
              localUser.preferences
            )

            setCurrentSession(session)
          }
        }

        const curr = await storageService.getCurrentUser?.()

        if (curr) {

          setUser(curr)

          if (curr.preferences) {

            const session = await storageService.getOrCreateSession(
              curr.id,
              curr.preferences
            )

            setCurrentSession(session)
          }
        }

      } catch (error) {

        console.error(error)
        toast.error('Erreur chargement')

      }

    }

    init()

    const { data } = supabase.auth.onAuthStateChange(
      async (event, session) => {

        if (event === 'SIGNED_OUT') {

          setUser(null)
          setCurrentSession(null)

        }

        if (event === 'SIGNED_IN' && session?.user) {

          const profile = await storageService.getCurrentUser?.()

          if (profile) {

            setUser(profile)
            toast.success(`Bienvenue ${profile.username}`)

          }

        }

      }
    )

    return () => {

      data?.subscription?.unsubscribe()

    }

  }, [])

  // ============================================================================
  // DARK MODE
  // ============================================================================

  useEffect(() => {

    if (isDarkMode) {

      document.documentElement.classList.add('dark')
      localStorage.setItem('tm_theme', 'dark')

    } else {

      document.documentElement.classList.remove('dark')
      localStorage.setItem('tm_theme', 'light')

    }

  }, [isDarkMode])

  // ============================================================================
  // HANDLERS
  // ============================================================================

  const handleLoginSuccess = async (profile: UserProfile) => {

    setUser(profile)
    setShowAuth(false)

    if (profile.preferences) {

      const session = await storageService.getOrCreateSession(
        profile.id,
        profile.preferences
      )

      setCurrentSession(session)

    }

  }

  const handleLogout = async () => {

    await supabase.auth.signOut()

    setUser(null)
    setCurrentSession(null)

  }

  const handleUpdateSession = async (session: LearningSession) => {

    setCurrentSession(session)

    await storageService.saveSession?.(session)

  }

  const handleGenerateExercise = async () => {

    if (!user || !currentSession?.chatHistory) return

    setIsGeneratingExercise(true)

    try {

      const exercises = await generateExerciseFromHistory(
        currentSession.chatHistory,
        user
      )

      if (exercises.length) {

        setCurrentExercises(exercises)
        setActiveMode('exercise')

      }

    } catch (error) {

      toast.error('Erreur génération exercice')

    } finally {

      setIsGeneratingExercise(false)

    }

  }

  // ============================================================================
  // VERIFY CERT
  // ============================================================================

  if (verifyCertId) {

    return (
      <Suspense fallback={<LoadingFallback message="Vérification..." />}>
        <VerifyCertificate
          certId={verifyCertId}
          onClose={() => setVerifyCertId(null)}
        />
      </Suspense>
    )

  }

  // ============================================================================
  // AUTH
  // ============================================================================

  if (showAuth) {

    return (
      <Suspense fallback={<LoadingFallback />}>
        <AuthScreen
          onLoginSuccess={handleLoginSuccess}
          onClose={() => setShowAuth(false)}
        />
        <Toaster />
      </Suspense>
    )

  }

  // ============================================================================
  // LANDING
  // ============================================================================

  if (!user || user.id === 'guest') {

    return (
      <Suspense fallback={<LoadingFallback />}>
        <LandingPage
          onLogin={() => setShowAuth(true)}
          guestUser={GUEST_USER}
          isDarkMode={isDarkMode}
          toggleDarkMode={() => setIsDarkMode(!isDarkMode)}
        />
        <Toaster />
      </Suspense>
    )

  }

  // ============================================================================
  // MAIN
  // ============================================================================

  return (
    <div className="relative min-h-screen">

      <Suspense fallback={<LoadingFallback />}>

        {showDashboard && (

          <SmartDashboard
            user={user}
            onClose={() => setShowDashboard(false)}
            onUpdateUser={setUser}
            onOpenPayment={() => setShowPayment(true)}
          />

        )}

        {showPayment && (

          <PaymentModal
            user={user}
            onClose={() => setShowPayment(false)}
            onSuccess={(credits: number) => {
              setUser({ ...user, credits })
            }}
          />

        )}

        {activeMode === 'chat' && currentSession && (

          <ChatInterface
            user={user}
            session={currentSession}
            onUpdateSession={handleUpdateSession}
            onGenerateExercise={handleGenerateExercise}
            isGeneratingExercise={isGeneratingExercise}
            onOpenDashboard={() => setShowDashboard(true)}
            onLogout={handleLogout}
            onChangeMode={(mode: any) => setActiveMode(mode)}
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
            onShowPayment={() => setShowPayment(true)}
          />

        )}

        {user.preferences && (

          <TutorialAgent
            user={user}
            preferences={user.preferences}
          />

        )}

        {import.meta.env.DEV && <DebugConsole />}

        <Toaster />

      </Suspense>

    </div>
  )

}

export default App

declare global {
  interface Window {
    errorService?: any
  }
}
