import { UserProfile, ChatMessage, ExerciseItem } from "../types";
import { SYSTEM_PROMPT_TEMPLATE, SUPPORT_AGENT_PROMPT } from "../constants";
import { storageService } from "./storageService";
import { creditService, CREDIT_COSTS } from "./creditService";
import { supabase, supabaseUrl, supabaseAnonKey } from "../lib/supabase";

// ── Constantes ────────────────────────────────────────────────────────────────
const EDGE_FUNCTION_NAME = 'gemini-api';

export const TEXT_MODEL = 'gemini-3-flash-preview';
export const TEXT_MODEL_FALLBACK = 'gemini-2.0-flash';
export const AUDIO_MODEL = 'gemini-2.5-flash-preview-tts';

// ── Helper : appel Edge Function avec retry ───────────────────────────────────
const callGeminiFunction = async (
  action: string,
  payload: any,
  maxRetries: number = 2
): Promise<any> => {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const { data, error } = await supabase.functions.invoke(EDGE_FUNCTION_NAME, {
        body: { action, ...payload },
      });

      if (error) {
        const errMsg = (error as any)?.message ||
          (error as any)?.context?.errorMessage ||
          JSON.stringify(error);
        console.error(`[EdgeFunction] ${EDGE_FUNCTION_NAME}/${action} — Erreur réseau:`, error);
        lastError = new Error(errMsg);

        const status = (error as any)?.status || 0;
        if (status === 400 || status === 401 || status === 404) throw lastError;

        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
          continue;
        }
        throw lastError;
      }

      if (data?.error) {
        console.error(`[EdgeFunction] ${action} — Erreur applicative:`, data.error);
        throw new Error(data.error);
      }

      return data;

    } catch (e: any) {
      lastError = e;
      if (attempt < maxRetries) {
        console.warn(`[Gemini] Tentative ${attempt + 1}/${maxRetries + 1} échouée, retry...`);
        await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
      }
    }
  }

  throw lastError || new Error("Erreur de communication avec l'IA");
};

// ── Helper : récupérer le token auth ─────────────────────────────────────────
const getAuthToken = async (): Promise<string> => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || supabaseAnonKey || '';
  } catch {
    return supabaseAnonKey || '';
  }
};

// ── 1. SUPPORT AGENT ──────────────────────────────────────────────────────────
export const generateSupportResponse = async (
  userQuery: string,
  context: string,
  user: UserProfile,
  history: { role: string; text: string }[]
): Promise<string> => {
  if (!storageService.canUseSupportAgent()) {
    return "⛔ Quota journalier d'aide atteint (100/100). Revenez demain.";
  }

  try {
    const systemInstruction = SUPPORT_AGENT_PROMPT(context, user);
    const prompt = history.length > 0
      ? `Historique:\n${history.map(h => `${h.role}: ${h.text}`).join('\n')}\n\nQuestion: ${userQuery}`
      : userQuery;

    const data = await callGeminiFunction('generate', {
      model: TEXT_MODEL,
      contents: prompt,
      config: { systemInstruction, maxOutputTokens: 2000, temperature: 0.5 },
    });

    storageService.incrementSupportUsage();
    return data?.text || "Je n'ai pas de réponse pour le moment.";

  } catch (e: any) {
    console.error("[Gemini] Support error:", e.message);
    return "Désolé, je rencontre un problème technique momentané. Veuillez réessayer.";
  }
};

// ── 2. CHAT PRINCIPAL (STREAMING) ─────────────────────────────────────────────
export async function* sendMessageStream(
  message: string,
  user: UserProfile,
  history: ChatMessage[]
) {
  if (!user.preferences) {
    yield "⚠️ Profil incomplet. Veuillez configurer vos préférences.";
    return;
  }

  if (!(await creditService.checkBalance(user.id, CREDIT_COSTS.LESSON))) {
    yield "⛔ **Crédits épuisés.**\n\nVeuillez recharger votre compte pour continuer.";
    return;
  }

  try {
    console.log("[Gemini] Stream démarré. Modèle:", TEXT_MODEL);

    const recentHistory = history.slice(-15);
    const contextPrompt = recentHistory
      .filter(msg => msg.text?.trim())
      .map(msg => `${msg.role === 'user' ? 'Élève' : 'Professeur'}: ${msg.text}`)
      .join('\n\n');

    const finalMessage = contextPrompt
      ? `Contexte précédent:\n${contextPrompt}\n\nNouveau message de l'élève: ${message}`
      : message;

    const token = await getAuthToken();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);

    const response = await fetch(`${supabaseUrl}/functions/v1/${EDGE_FUNCTION_NAME}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': supabaseAnonKey || '',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify({
        action: 'generate_stream',
        model: TEXT_MODEL,
        contents: finalMessage,
        config: {
          systemInstruction: SYSTEM_PROMPT_TEMPLATE(user, user.preferences!),
          temperature: 0.7,
          maxOutputTokens: 8192,
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Edge Function Stream Error (${response.status}): ${errText.slice(0, 200)}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("Pas de stream disponible");

    const decoder = new TextDecoder();
    let buffer = '';
    let hasYieldedText = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const event of events) {
          const dataLine = event.split('\n').find(l => l.startsWith('data: '));
          if (!dataLine) continue;

          const raw = dataLine.slice(6).trim();
          if (raw === '[DONE]') continue;

          try {
            const parsed = JSON.parse(raw);
            if (parsed.error) throw new Error(parsed.error);

            const chunk = parsed.text ||
              parsed.candidates?.[0]?.content?.parts?.[0]?.text ||
              parsed.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('');

            if (chunk) {
              yield chunk;
              hasYieldedText = true;
            }
          } catch (parseErr: any) {
            if (parseErr.message && !parseErr.message.includes('JSON')) {
              throw parseErr;
            }
          }
        }
      }
    } finally {
      reader.cancel().catch(() => {});
    }

    if (!hasYieldedText) {
      yield "⚠️ Aucune réponse reçue. Veuillez réessayer.";
      return;
    }

    console.log("[Gemini] Stream terminé avec succès.");
    await creditService.deduct(user.id, CREDIT_COSTS.LESSON);

  } catch (e: any) {
    if (e.name === 'AbortError') {
      yield "⏱️ Le serveur met trop de temps à répondre. Veuillez réessayer.";
    } else {
      console.error("[Gemini] Stream exception:", e.message);
      yield "⚠️ Désolé, le service est temporairement indisponible. Veuillez réessayer dans un instant.";
    }
  }
}

// ── 3. TTS ────────────────────────────────────────────────────────────────────
export const generateSpeech = async (
  text: string,
  voiceName: string = 'Kore',
  cost: number = CREDIT_COSTS.AUDIO_MESSAGE
): Promise<ArrayBuffer | null> => {
  const user = await storageService.getCurrentUser();
  if (!user || !(await creditService.checkBalance(user.id, cost))) return null;

  try {
    console.log(`[Gemini TTS] Génération voix "${voiceName}"...`);

    // ✅ action 'tts' (correspondance exacte avec l'Edge Function)
    const data = await callGeminiFunction('tts', {
      text,
      voiceName,
      model: AUDIO_MODEL,
    });

    if (!data?.audioBase64) {
      console.warn("[Gemini TTS] Pas de données audio.");
      return null;
    }

    await creditService.deduct(user.id, cost);

    const binaryString = atob(data.audioBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    console.log("[Gemini TTS] Audio généré avec succès.");
    return bytes.buffer as ArrayBuffer;

  } catch (e: any) {
    console.warn("[Gemini TTS] Échec:", e.message);
    return null;
  }
};

// ── 4. EXTRACTION VOCABULAIRE ─────────────────────────────────────────────────
export const extractVocabulary = async (history: ChatMessage[]): Promise<any[]> => {
  const user = await storageService.getCurrentUser();
  if (!user) return [];

  const context = history.slice(-6).map(m => `${m.role}: ${m.text}`).join('\n');
  const prompt = `Based on the following conversation, extract 3 to 5 key vocabulary words. Return a JSON array with objects: word, translation, example.\n\nConversation:\n${context}`;

  try {
    const data = await callGeminiFunction('generate_json', {
      model: TEXT_MODEL,
      contents: prompt,
      schemaType: 'ARRAY_VOCAB',
    });

    return (data?.json || []).map((item: any) => ({
      id: crypto.randomUUID(),
      word: item.word || '',
      translation: item.translation || '',
      example: item.example || '',
      mastered: false,
      addedAt: Date.now(),
    }));
  } catch (e) {
    return [];
  }
};

// ── 5. EXERCICES ──────────────────────────────────────────────────────────────
export const generateExerciseFromHistory = async (
  history: ChatMessage[],
  user: UserProfile
): Promise<ExerciseItem[]> => {
  if (!(await creditService.checkBalance(user.id, CREDIT_COSTS.EXERCISE))) return [];

  const context = history.slice(-10).map(m => `${m.role}: ${m.text}`).join('\n');
  const prompt = `Génère 3 exercices variés (QCM ou Vrai/Faux) adaptés au niveau ${user.preferences?.level} en ${user.preferences?.targetLanguage}. Basé sur:\n${context}`;

  try {
    const data = await callGeminiFunction('generate_json', {
      model: TEXT_MODEL,
      contents: prompt,
      schemaType: 'ARRAY_EXERCISE',
    });

    await creditService.deduct(user.id, CREDIT_COSTS.EXERCISE);
    return data?.json || [];
  } catch (e) {
    return [];
  }
};

// ── 6. ROLEPLAY ───────────────────────────────────────────────────────────────
export const generateRoleplayResponse = async (
  history: ChatMessage[],
  scenarioPrompt: string,
  user: UserProfile,
  isClosing: boolean = false,
  _isInitial: boolean = false
): Promise<{ aiReply: string; correction?: string; explanation?: string; score?: number; feedback?: string }> => {
  if (!(await creditService.checkBalance(user.id, CREDIT_COSTS.DIALOGUE_MESSAGE))) {
    return { aiReply: "⚠️ Crédits insuffisants." };
  }

  const sysInstruct = `Tu es un partenaire de jeu de rôle en ${user.preferences?.targetLanguage} (niveau ${user.preferences?.level}). Scénario: ${scenarioPrompt}. Réponds en JSON avec: aiReply, correction (si faute), explanation, score (0-100).`;

  const contextPrompt = history
    .filter(msg => msg.text?.trim())
    .map(m => `${m.role}: ${m.text}`)
    .join('\n');

  const finalPrompt = isClosing
    ? `${contextPrompt}\n\nFais l'évaluation finale de la conversation.`
    : (contextPrompt || "Commence le jeu de rôle.");

  try {
    const data = await callGeminiFunction('generate_json', {
      model: TEXT_MODEL,
      contents: finalPrompt,
      config: { systemInstruction: sysInstruct },
      schemaType: 'OBJECT_ROLEPLAY',
    });

    await creditService.deduct(user.id, CREDIT_COSTS.DIALOGUE_MESSAGE);
    return data?.json || { aiReply: "Continuons la conversation." };
  } catch (e) {
    return { aiReply: "Problème technique. Veuillez réessayer." };
  }
};

// ── 7. GÉNÉRATION TEXTE GÉNÉRIQUE ─────────────────────────────────────────────
export const generateText = async (
  prompt: string,
  model?: string
): Promise<string> => {
  try {
    const data = await callGeminiFunction('generate', {
      model: model || TEXT_MODEL,
      contents: prompt,
    });
    return data?.text || "";
  } catch (e: any) {
    console.error("[Gemini] generateText error:", e.message);
    return "";
  }
};
