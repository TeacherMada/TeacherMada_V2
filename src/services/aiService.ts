// ============================================================================
// FRONTEND SERVICE : aiService (PRODUCTION)
// ============================================================================
// Path: src/services/aiService.ts
// Remplace TOUTE la logique de crédits côté frontend
// ============================================================================

import { supabase } from '../lib/supabase'

// ══════════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════════

export type ActionType = 
  | 'ai_simple'
  | 'lesson'
  | 'exercise'
  | 'dialogue_response'
  | 'call_start'
  | 'call_minute'
  | 'diagnostic'
  | 'exam'
  | 'certificate'

export interface AIRequestParams {
  action_type: ActionType
  prompt: string
  model?: string
  temperature?: number
  action_id?: string
  idempotency_key?: string
}

export interface AIResponse {
  success: boolean
  response?: string
  error?: string
  balance?: number
  credits_deducted?: number
  credits_refunded?: boolean
  rate_limited?: boolean
}

// ══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ══════════════════════════════════════════════════════════════════════════

const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-request`

// ══════════════════════════════════════════════════════════════════════════
// SERVICE PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════

export const aiService = {

  /**
   * Appeler l'IA via Edge Function (gestion crédits atomique côté serveur)
   */
  async request(params: AIRequestParams): Promise<AIResponse> {
    console.log('[AIService] ━━━━━━ REQUEST START ━━━━━━')
    console.log('[AIService] Action:', params.action_type)
    console.log('[AIService] Prompt length:', params.prompt.length, 'chars')

    try {
      // Récupérer session token
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()
      
      if (sessionError || !session) {
        console.error('[AIService] No valid session')
        return {
          success: false,
          error: 'Non connecté. Veuillez vous reconnecter.',
        }
      }

      // Appeler Edge Function
      console.log('[AIService] Calling Edge Function...')
      const startTime = Date.now()

      const response = await fetch(EDGE_FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(params),
      })

      const duration = Date.now() - startTime
      console.log('[AIService] Response received in', duration, 'ms')

      const data: AIResponse = await response.json()

      // Gestion erreurs HTTP
      if (!response.ok) {
        console.warn('[AIService] HTTP error:', response.status, data.error)
        
        if (response.status === 402) {
          // Crédits insuffisants
          return {
            success: false,
            error: 'Crédits insuffisants pour cette action.',
            balance: data.balance || 0,
          }
        }

        if (response.status === 429) {
          // Rate limit
          return {
            success: false,
            error: 'Trop de requêtes. Veuillez patienter.',
            rate_limited: true,
          }
        }

        return {
          success: false,
          error: data.error || 'Erreur serveur',
        }
      }

      // Succès
      if (data.success) {
        console.log('[AIService] ✅ SUCCESS')
        console.log('[AIService] New balance:', data.balance)
        console.log('[AIService] Credits deducted:', data.credits_deducted)
        console.log('[AIService] ━━━━━━ REQUEST END (SUCCESS) ━━━━━━')
        return data
      }

      // Échec IA (mais crédits remboursés)
      console.warn('[AIService] ⚠️ AI FAILED (credits refunded)')
      console.log('[AIService] Error:', data.error)
      console.log('[AIService] ━━━━━━ REQUEST END (REFUNDED) ━━━━━━')
      return data

    } catch (error: any) {
      console.error('[AIService] ❌ Exception:', error)
      console.log('[AIService] ━━━━━━ REQUEST END (EXCEPTION) ━━━━━━')
      return {
        success: false,
        error: 'Erreur réseau. Vérifiez votre connexion.',
      }
    }
  },

  /**
   * Helpers pour actions spécifiques
   */

  async generateLesson(prompt: string): Promise<AIResponse> {
    return this.request({
      action_type: 'lesson',
      prompt,
      model: 'gemini-1.5-flash',
      temperature: 0.7,
    })
  },

  async generateExercise(prompt: string): Promise<AIResponse> {
    return this.request({
      action_type: 'exercise',
      prompt,
      model: 'gemini-1.5-flash',
      temperature: 0.8,
    })
  },

  async getDialogueResponse(prompt: string, sessionId: string): Promise<AIResponse> {
    return this.request({
      action_type: 'dialogue_response',
      prompt,
      model: 'gemini-1.5-flash',
      temperature: 0.9,
      action_id: sessionId,
      idempotency_key: `dialogue_${sessionId}_${Date.now()}`,
    })
  },

  async startCall(userId: string): Promise<AIResponse> {
    return this.request({
      action_type: 'call_start',
      prompt: 'call_started', // Pas d'appel Gemini, juste déduction
      action_id: `call_${userId}_${Date.now()}`,
    })
  },

  async deductCallMinute(userId: string, callId: string): Promise<AIResponse> {
    return this.request({
      action_type: 'call_minute',
      prompt: 'call_minute',
      action_id: callId,
      idempotency_key: `call_${callId}_${Math.floor(Date.now() / 60000)}`, // 1 par minute
    })
  },

  async generateDiagnostic(prompt: string): Promise<AIResponse> {
    return this.request({
      action_type: 'diagnostic',
      prompt,
      model: 'gemini-1.5-pro', // Pro pour meilleure qualité
      temperature: 0.5,
    })
  },

  async generateExam(prompt: string): Promise<AIResponse> {
    return this.request({
      action_type: 'exam',
      prompt,
      model: 'gemini-1.5-pro',
      temperature: 0.3,
    })
  },

  async unlockCertificate(examId: string): Promise<AIResponse> {
    return this.request({
      action_type: 'certificate',
      prompt: `unlock_certificate_${examId}`,
      action_id: examId,
    })
  },
}

// ══════════════════════════════════════════════════════════════════════════
// REALTIME UPDATES (Écouter changements crédits)
// ══════════════════════════════════════════════════════════════════════════

export function subscribeToCreditsUpdates(
  userId: string,
  onUpdate: (newBalance: number) => void
): () => void {
  console.log('[AIService] 🔔 Subscribing to realtime credits updates for user:', userId)

  const channel = supabase
    .channel(`profile_credits:${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'profiles',
        filter: `id=eq.${userId}`,
      },
      (payload) => {
        if (payload.new && typeof payload.new.credits === 'number') {
          const newBalance = payload.new.credits
          console.log('[AIService] 🔔 Realtime update: new balance =', newBalance)
          onUpdate(newBalance)
        }
      }
    )
    .subscribe()

  // Retourner fonction de cleanup
  return () => {
    console.log('[AIService] 🔕 Unsubscribing from realtime updates')
    supabase.removeChannel(channel)
  }
}

// ══════════════════════════════════════════════════════════════════════════
// EXEMPLE D'UTILISATION
// ══════════════════════════════════════════════════════════════════════════
//
// import { aiService, subscribeToCreditsUpdates } from './services/aiService'
//
// // Dans un composant React :
//
// const handleGenerateLesson = async () => {
//   setLoading(true)
//   
//   const result = await aiService.generateLesson(
//     'Explique-moi les verbes irréguliers en anglais'
//   )
//   
//   if (result.success) {
//     setLesson(result.response)
//     toast.success(`Leçon générée ! Nouveau solde: ${result.balance} crédits`)
//   } else {
//     toast.error(result.error)
//   }
//   
//   setLoading(false)
// }
//
// // Écouter mises à jour temps réel :
//
// useEffect(() => {
//   const unsubscribe = subscribeToCreditsUpdates(user.id, (newBalance) => {
//     setUser({ ...user, credits: newBalance })
//   })
//   
//   return unsubscribe
// }, [user.id])
//
// ══════════════════════════════════════════════════════════════════════════
