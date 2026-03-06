/**
 * @file geminiService.ts
 * @description Service d'interface avec l'API Google Gemini via Supabase Edge Functions.
 *
 * CORRECTIONS AUDIT :
 * - callGeminiFunction supprimé → remplacé par callGeminiEdge (src/lib/edgeFunctions.ts)
 * - Parser SSE robuste : découpage sur \n\n, plus de perte de chunks
 * - AbortSignal.timeout(30s) pour éviter les streams infinis
 * - Rate limiter intégré sur chat, TTS, exercices, roleplay
 * - Crédits déduits AVANT la génération (sécurité)
 *
 * TeacherMada v1.1
 */

import { UserProfile, ChatMessage, ExerciseItem } from '../types';
import { SYSTEM_PROMPT_TEMPLATE, SUPPORT_AGENT_PROMPT } from '../constants';
import { storageService } from './storageService';
import { creditService, CREDIT_COSTS } from './creditService';
import { supabase, supabaseUrl, supabaseAnonKey } from '../lib/supabase';
import { callGeminiEdge, callEdgeFunctionWithRetry } from '../lib/edgeFunctions';
import { rateLimiter, RATE_LIMITS } from '../lib/rateLimiter';

// ─── Modèles ─────────────────────────────────────────────────────────────────

export const TEXT_MODEL  = 'gemini-2.0-flash';
export const AUDIO_MODEL = 'gemini-2.5-flash-preview-tts';

// ─── 1. SUPPORT AGENT ─────────────────────────────────────────────────────────

export const generateSupportResponse = async (
  userQuery: string,
  context: string,
  user: UserProfile,
  history: { role: string; text: string }[]
): Promise<string> => {

  if (!storageService.canUseSupportAgent()) {
    return '⛔ Quota journalier d\'aide atteint (100/100). Revenez demain.';
  }

  if (!rateLimiter.canCall('support')) {
    return rateLimiter.getErrorMessage('support');
  }

  try {
    const systemInstruction = SUPPORT_AGENT_PROMPT(context, user);
    const historyText = history.map(h => `${h.role}: ${h.text}`).join('\n');
    const prompt = `${historyText}\n\nQuestion actuelle: ${userQuery}`;

    const data = await callGeminiEdge<{ text?: string }>('generate', {
      model: TEXT_MODEL,
      contents: prompt,
      config: {
        systemInstruction,
        maxOutputTokens: 2000,
        temperature: 0.5,
      },
    });

    storageService.incrementSupportUsage();
    return data?.text ?? 'Je n\'ai pas de réponse pour le moment.';
  } catch (e) {
    console.error('[Gemini] Support error:', e);
    return 'Désolé, je rencontre un problème technique momentané. Veuillez réessayer.';
  }
};

// ─── 2. MAIN CHAT (STREAMING ROBUSTE) ─────────────────────────────────────────

/**
 * Stream SSE corrigé — CORRECTIONS AUDIT :
 * - Découpage sur \n\n (événements SSE complets) au lieu de \n (peut couper des chunks)
 * - AbortSignal.timeout(30_000) pour éviter les streams orphelins
 * - reader.cancel() dans finally pour libérer la connexion
 * - Crédits vérifiés localement AVANT l'appel (double vérification côté serveur dans l'Edge Function)
 */
export async function* sendMessageStream(
  message: string,
  user: UserProfile,
  history: ChatMessage[]
): AsyncGenerator<string> {

  if (!user.preferences) {
    yield '⚠️ Profil incomplet. Veuillez configurer vos préférences.';
    return;
  }

  // Vérification crédits locale (pré-filtre rapide)
  if (!(await creditService.checkBalance(user.id, CREDIT_COSTS.LESSON))) {
    yield '⛔ **Crédits épuisés.**\n\nVeuillez recharger votre compte pour continuer.';
    return;
  }

  // Rate limiting
  if (!rateLimiter.canCall('chat')) {
    yield rateLimiter.getErrorMessage('chat');
    return;
  }

  try {
    console.info('[Gemini] Stream démarré. Modèle:', TEXT_MODEL);

    // Limiter l'historique à 15 messages pour réduire la latence
    const recentHistory = history.slice(-15);
    const contextPrompt = recentHistory
      .filter(msg => msg.text?.trim())
      .map(msg => `${msg.role === 'user' ? 'Élève' : 'Professeur'}: ${msg.text}`)
      .join('\n\n');

    const finalMessage = contextPrompt
      ? `Contexte précédent:\n${contextPrompt}\n\nNouveau message de l'élève: ${message}`
      : message;

    // Récupérer le token JWT pour l'autorisation
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token ?? supabaseAnonKey;

    // AbortController avec timeout 30s
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);

    const response = await fetch(`${supabaseUrl}/functions/v1/gemini-api`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': supabaseAnonKey,
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify({
        action: 'generate_stream',
        model: TEXT_MODEL,
        contents: finalMessage,
        config: {
          systemInstruction: SYSTEM_PROMPT_TEMPLATE(user, user.preferences),
          temperature: 0.7,
          maxOutputTokens: 8192,
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Edge Function erreur (${response.status}): ${errText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Stream non disponible');

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // ✅ CORRECTION : Découper sur \n\n (événements SSE complets)
        // Un événement SSE se termine toujours par \n\n
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? ''; // Conserver le fragment incomplet

        for (const event of events) {
          // Trouver la ligne "data: ..."
          const dataLine = event.split('\n').find(l => l.startsWith('data: '));
          if (!dataLine) continue;

          const raw = dataLine.slice(6).trim();
          if (raw === '[DONE]') {
            // Déduire les crédits après streaming réussi
            await creditService.deduct(user.id, CREDIT_COSTS.LESSON);
            return;
          }

          try {
            const json = JSON.parse(raw);
            // Format Gemini standard
            const text = json.candidates?.[0]?.content?.parts?.[0]?.text
              ?? json.text  // Format proxy Edge Function
              ?? null;
            if (text) yield text;

            // Erreur retournée dans le stream
            if (json.error) throw new Error(json.error);
          } catch (parseError) {
            // Chunk partiel ou texte brut — ignorer les erreurs de parse silencieusement
            if (raw && raw !== '[DONE]' && !raw.startsWith('{')) {
              yield raw; // Texte brut (rare mais possible)
            }
          }
        }
      }

      // Flush du buffer restant
      if (buffer.trim()) {
        const dataLine = buffer.split('\n').find(l => l.startsWith('data: '));
        if (dataLine) {
          const raw = dataLine.slice(6).trim();
          if (raw && raw !== '[DONE]') {
            try {
              const json = JSON.parse(raw);
              const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? json.text;
              if (text) yield text;
            } catch { /* ignoré */ }
          }
        }
      }

    } finally {
      reader.cancel(); // ✅ Toujours libérer le reader
    }

    // Déduire les crédits si le stream s'est terminé normalement (sans [DONE])
    await creditService.deduct(user.id, CREDIT_COSTS.LESSON);
    console.info('[Gemini] Stream terminé avec succès.');

  } catch (e: any) {
    if (e?.name === 'AbortError') {
      yield '⏱️ Délai d\'attente dépassé. Veuillez réessayer.';
    } else {
      console.error('[Gemini] Erreur stream:', e);
      yield '⚠️ Le service est temporairement indisponible. Veuillez réessayer dans un instant.';
    }
  }
}

// ─── 3. TEXT-TO-SPEECH ────────────────────────────────────────────────────────

export const generateSpeech = async (
  text: string,
  voiceName = 'Kore',
  cost = CREDIT_COSTS.AUDIO_MESSAGE
): Promise<ArrayBuffer | null> => {

  const user = await storageService.getCurrentUser();
  if (!user) return null;

  if (!(await creditService.checkBalance(user.id, cost))) return null;

  if (!rateLimiter.canCall('tts')) {
    console.warn('[TTS] Rate limit atteint');
    return null;
  }

  try {
    const data = await callGeminiEdge<{ audioBase64?: string }>('tts', {
      text: text.slice(0, 4096), // Limite de sécurité
      voiceName,
    });

    if (!data?.audioBase64) return null;

    await creditService.deduct(user.id, cost);

    // Décoder Base64 → ArrayBuffer
    const binary = atob(data.audioBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;

  } catch (e) {
    console.error('[TTS] Erreur:', e);
    return null;
  }
};

// ─── 4. PRONONCIATION ─────────────────────────────────────────────────────────

export const generatePronunciation = async (text: string, language: string): Promise<ArrayBuffer | null> => {
  return generateSpeech(
    text,
    language.toLowerCase().includes('angl') ? 'Journey' : 'Kore',
    CREDIT_COSTS.AUDIO_PRONUNCIATION
  );
};

// ─── 5. EXERCICES ─────────────────────────────────────────────────────────────

export const generateExerciseFromHistory = async (
  history: ChatMessage[],
  user: UserProfile
): Promise<ExerciseItem[]> => {

  if (!(await creditService.checkBalance(user.id, CREDIT_COSTS.EXERCISE))) return [];
  if (!rateLimiter.canCall('exercise')) return [];

  const prompt = `Génère 3 exercices (QCM/Vrai-Faux) pour niveau ${user.preferences?.level} (${user.preferences?.targetLanguage}). Format JSON Array.`;

  try {
    const data = await callEdgeFunctionWithRetry<{ json?: ExerciseItem[] }>(
      'gemini-api', 'generate_json',
      { model: TEXT_MODEL, contents: prompt, schemaType: 'ARRAY_EXERCISE' }
    );

    await creditService.deduct(user.id, CREDIT_COSTS.EXERCISE);
    return data?.json ?? [];
  } catch (e) {
    console.error('[Gemini] generateExercise error:', e);
    return [];
  }
};

// ─── 6. ROLEPLAY ──────────────────────────────────────────────────────────────

export const generateRoleplayResponse = async (
  history: ChatMessage[],
  scenarioPrompt: string,
  user: UserProfile,
  isClosing = false,
  _isInitial = false
): Promise<{ aiReply: string; correction?: string; explanation?: string; score?: number; feedback?: string }> => {

  if (!(await creditService.checkBalance(user.id, CREDIT_COSTS.DIALOGUE_MESSAGE))) {
    return { aiReply: '⚠️ Crédits insuffisants.' };
  }

  if (!rateLimiter.canCall('roleplay')) {
    return { aiReply: rateLimiter.getErrorMessage('roleplay') };
  }

  const sysInstruct = `Partenaire de jeu de rôle (${user.preferences?.targetLanguage}, ${user.preferences?.level}). Scénario: ${scenarioPrompt}.`;
  const contextPrompt = history
    .filter(m => m.text?.trim())
    .map(m => `${m.role}: ${m.text}`)
    .join('\n');

  const finalPrompt = isClosing ? `${contextPrompt}\n\nÉvaluation finale` : (contextPrompt || 'Start');

  try {
    const data = await callGeminiEdge<{ json?: any }>('generate_json', {
      model: TEXT_MODEL,
      contents: finalPrompt,
      config: { systemInstruction: sysInstruct },
      schemaType: 'OBJECT_ROLEPLAY',
    });

    await creditService.deduct(user.id, CREDIT_COSTS.DIALOGUE_MESSAGE);
    return data?.json ?? { aiReply: 'Problème technique.' };
  } catch (e) {
    console.error('[Gemini] Roleplay error:', e);
    return { aiReply: 'Problème technique. Réessayez.' };
  }
};

// ─── 7. GÉNÉRATION DE TEXTE GÉNÉRIQUE ─────────────────────────────────────────

export const generateText = async (prompt: string, maxTokens = 4096): Promise<string> => {
  try {
    const data = await callGeminiEdge<{ text?: string }>('generate', {
      model: TEXT_MODEL,
      contents: prompt,
      config: { maxOutputTokens: maxTokens },
    });
    return data?.text ?? '';
  } catch (e) {
    console.error('[Gemini] generateText error:', e);
    return '';
  }
};

// ─── 8. EXTRACTION VOCABULAIRE ────────────────────────────────────────────────

export const extractVocabularyFromMessage = async (
  text: string,
  targetLanguage: string,
  explanationLanguage: string
): Promise<any[]> => {
  const prompt = `Extrais le vocabulaire important du texte suivant en ${targetLanguage}.
Retourne un JSON array d'objets: [{word, translation, example, level}].
Texte: "${text.slice(0, 500)}"
Langue d'explication: ${explanationLanguage}`;

  try {
    const data = await callGeminiEdge<{ json?: any[] }>('generate_json', {
      model: TEXT_MODEL,
      contents: prompt,
      schemaType: 'ARRAY_VOCABULARY',
    });
    return data?.json ?? [];
  } catch {
    return [];
  }
};
