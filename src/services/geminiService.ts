import { UserProfile, ChatMessage, ExerciseItem } from "../types";
import { SYSTEM_PROMPT_TEMPLATE, SUPPORT_AGENT_PROMPT } from "../constants";
import { storageService } from "./storageService";
import { creditService, CREDIT_COSTS } from "./creditService";
import { supabase } from "../lib/supabase";

// --- CLIENT GEMINI VIA SUPABASE EDGE FUNCTION ---
// Utilisation de la Edge Function pour sécuriser les clés API et gérer la rotation côté serveur.

const EDGE_FUNCTION_NAME = 'gemini-api';

// Helper pour appeler la Edge Function
const callGeminiFunction = async (action: string, payload: any) => {
    const { data, error } = await supabase.functions.invoke(EDGE_FUNCTION_NAME, {
        body: { action, ...payload }
    });

    if (error) {
        console.error(`[Gemini Function] Error calling ${action}:`, error);
        throw new Error(error.message || "Erreur de communication avec l'IA");
    }

    // Check for application-level error returned by function (200 OK but with error field)
    if (data && data.error) {
        console.error(`[Gemini Function] Application Error in ${action}:`, data.error);
        throw new Error(data.error);
    }

    return data;
};

// Modèles par défaut
export const TEXT_MODEL = 'gemini-3-flash-preview';
export const AUDIO_MODEL = 'gemini-2.5-flash-preview-tts';

// --- SERVICES EXPORTÉS ---

// 1. TUTORIAL AGENT (SUPPORT)
export const generateSupportResponse = async (
    userQuery: string,
    context: string,
    user: UserProfile,
    history: {role: string, text: string}[]
): Promise<string> => {
    
    if (!storageService.canUseSupportAgent()) {
        return "⛔ Quota journalier d'aide atteint (100/100). Revenez demain.";
    }

    try {
        const systemInstruction = SUPPORT_AGENT_PROMPT(context, user);
        
        // Rejouer l'historique si nécessaire (simplifié pour la stabilité)
        const prompt = `Historique de conversation:\n${history.map(h => `${h.role}: ${h.text}`).join('\n')}\n\nQuestion actuelle: ${userQuery}`;

        const data = await callGeminiFunction('generate', {
            model: TEXT_MODEL,
            contents: prompt,
            config: {
                systemInstruction: systemInstruction,
                maxOutputTokens: 2000, 
                temperature: 0.5
            }
        });
        
        storageService.incrementSupportUsage();
        return data.text || "Je n'ai pas de réponse pour le moment.";
    } catch (e) {
        console.error("Support error:", e);
        return "Désolé, je rencontre un problème technique momentané. Veuillez réessayer.";
    }
};

// 2. MAIN CHAT (STREAMING VIA EDGE FUNCTION)
// Note: Supabase Edge Functions support streaming response.
export async function* sendMessageStream(
  message: string,
  user: UserProfile,
  history: ChatMessage[]
) {
  if (!user.preferences) throw new Error("Profil incomplet");
  
  if (!(await creditService.checkBalance(user.id, CREDIT_COSTS.LESSON))) {
    yield "⛔ **Crédits épuisés.**\n\nVeuillez recharger votre compte pour continuer.";
    return;
  }

  try {
      console.log("[Gemini] Stream started via Edge Function. Model:", TEXT_MODEL);

      // Format history
      const contextPrompt = history
        .filter(msg => msg.text && msg.text.trim().length > 0)
        .map(msg => `${msg.role === 'user' ? 'Élève' : 'Professeur'}: ${msg.text}`)
        .join('\n\n');

      const finalMessage = contextPrompt ? `Contexte précédent:\n${contextPrompt}\n\nNouveau message de l'élève: ${message}` : message;
      console.log("[Gemini] Sending message:", finalMessage.substring(0, 100) + "...");

      // Call Edge Function with streaming enabled
      const response = await supabase.functions.invoke(EDGE_FUNCTION_NAME, {
          body: {
              action: 'generate_stream',
              model: TEXT_MODEL,
              contents: finalMessage,
              config: {
                  systemInstruction: SYSTEM_PROMPT_TEMPLATE(user, user.preferences!),
                  temperature: 0.7,
                  maxOutputTokens: 8192,
              }
          },
          headers: {
              Accept: 'text/event-stream',
          },
      });

      if (response.error) throw response.error;

      // Handle Streaming Response
      if (response.data instanceof Blob) {
           // If response is a Blob (sometimes happens with fetch polyfills), read it
           const text = await response.data.text();
           yield text;
      } else if (response.data && response.data.body) {
          // Real streaming
          const reader = response.data.body.getReader();
          const decoder = new TextDecoder();

          while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              const chunk = decoder.decode(value, { stream: true });
              // Parse SSE format if needed, or just raw text depending on function implementation
              // Assuming function returns raw text chunks for simplicity or SSE data: lines
              yield chunk;
          }
      } else {
          // Fallback for non-streaming response
          yield response.data.text || "";
      }
      
      console.log("[Gemini] Stream completed successfully.");
      await creditService.deduct(user.id, CREDIT_COSTS.LESSON);

  } catch (e: any) {
      console.error("[Gemini] Stream exception:", e);
      yield "⚠️ Désolé, le service est temporairement indisponible. Veuillez réessayer dans un instant.";
  }
}

// 3. TEXT-TO-SPEECH (TTS)
export const generateSpeech = async (text: string, voiceName: string = 'Kore', cost: number = CREDIT_COSTS.AUDIO_MESSAGE): Promise<ArrayBuffer | null> => {
    const user = await storageService.getCurrentUser();
    if (!user || !(await creditService.checkBalance(user.id, cost))) return null;

    try {
        console.log(`[Gemini TTS] Generating speech via Edge Function...`);
        
        const data = await callGeminiFunction('generate_speech', {
            text,
            voiceName,
            model: AUDIO_MODEL
        });

        if (!data.audioBase64) {
            console.warn("[Gemini TTS] No audio data received.");
            return null;
        }

        await creditService.deduct(user.id, cost);

        const binaryString = atob(data.audioBase64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        console.log("[Gemini TTS] Audio generated successfully.");
        return bytes.buffer as ArrayBuffer;

    } catch (e) {
        console.warn("[Gemini TTS] Failed:", e);
        return null;
    }
};

// 4. EXTRACTION VOCABULAIRE
export const extractVocabulary = async (history: ChatMessage[]): Promise<any[]> => {
    const user = await storageService.getCurrentUser();
    if (!user) return [];

    const context = history.slice(-6).map(m => `${m.role}: ${m.text}`).join('\n');
    const prompt = `Based on the following conversation, extract 3 to 5 key vocabulary words. Return JSON array [{word, translation, example}].\n${context}`;

    try {
        const data = await callGeminiFunction('generate_json', {
            model: TEXT_MODEL,
            contents: prompt,
            schemaType: 'ARRAY_VOCAB' // Pre-defined schema in Edge Function
        });

        const rawData = data.json || [];
        
        return rawData.map((item: any) => ({
            id: crypto.randomUUID(),
            word: item.word,
            translation: item.translation,
            example: item.example,
            mastered: false,
            addedAt: Date.now()
        }));

    } catch (e) {
        return [];
    }
};

// 5. EXERCICES
export const generateExerciseFromHistory = async (history: ChatMessage[], user: UserProfile): Promise<ExerciseItem[]> => {
    if (!(await creditService.checkBalance(user.id, CREDIT_COSTS.EXERCISE))) return [];

    const prompt = `Génère 3 exercices (QCM/Vrai-Faux) pour niveau ${user.preferences?.level} (${user.preferences?.targetLanguage}). Format JSON Array.`;

    try {
        const data = await callGeminiFunction('generate_json', {
            model: TEXT_MODEL,
            contents: prompt,
            schemaType: 'ARRAY_EXERCISE' // Pre-defined schema in Edge Function
        });
        
        await creditService.deduct(user.id, CREDIT_COSTS.EXERCISE);
        return data.json || [];
    } catch (e) {
        return [];
    }
};

// 6. ROLEPLAY
export const generateRoleplayResponse = async (
    history: ChatMessage[],
    scenarioPrompt: string,
    user: UserProfile,
    isClosing: boolean = false,
    isInitial: boolean = false
): Promise<{ aiReply: string; correction?: string; explanation?: string; score?: number; feedback?: string }> => {
    
    if (!(await creditService.checkBalance(user.id, CREDIT_COSTS.DIALOGUE_MESSAGE))) {
        return { aiReply: "⚠️ Crédits insuffisants." };
    }

    const sysInstruct = `Partenaire de jeu de rôle (${user.preferences?.targetLanguage}, ${user.preferences?.level}). Scénario: ${scenarioPrompt}.`;
    
    const contextPrompt = history
        .filter(msg => msg.text && msg.text.trim().length > 0)
        .map(m => `${m.role}: ${m.text}`)
        .join('\n');
        
    const finalPrompt = isClosing ? `${contextPrompt}\n\nÉvaluation finale` : (contextPrompt || "Start");

    try {
        const data = await callGeminiFunction('generate_json', {
            model: TEXT_MODEL,
            contents: finalPrompt,
            config: {
                systemInstruction: sysInstruct
            },
            schemaType: 'OBJECT_ROLEPLAY' // Pre-defined schema in Edge Function
        });

        await creditService.deduct(user.id, CREDIT_COSTS.DIALOGUE_MESSAGE);
        return data.json || {};
    } catch (e) {
        return { aiReply: "Problème technique." };
    }
};

// 7. GENERIC TEXT GENERATION
export const generateText = async (prompt: string): Promise<string> => {
    try {
        const data = await callGeminiFunction('generate', {
            model: TEXT_MODEL,
            contents: prompt
        });
        return data.text || "";
    } catch (e) {
        console.error("generateText error:", e);
        return "";
    }
};