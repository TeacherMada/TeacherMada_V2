import { Type, Modality } from "@google/genai";
import { UserProfile, ChatMessage, ExerciseItem } from "../types";
import { SYSTEM_PROMPT_TEMPLATE, SUPPORT_AGENT_PROMPT } from "../constants";
import { storageService } from "./storageService";
import { creditService, CREDIT_COSTS } from "./creditService";
import { supabase, supabaseUrl, supabaseAnonKey } from "../lib/supabase";

// --- MOTEUR D'APPEL EDGE FUNCTION ---
// The Edge Function handles model rotation, API keys, and retries.
// The client just sends the payload.

/**
 * Helper to get a fresh session token or fall back to Anon Key
 */
const getFreshSessionToken = async (): Promise<{ token: string, isAnon: boolean }> => {
    if (!supabaseUrl || !supabaseAnonKey) {
        console.error("[Gemini] Critical: Missing Supabase configuration");
        throw new Error("Configuration Supabase manquante.");
    }

    try {
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error || !session?.access_token) {
            return { token: supabaseAnonKey, isAnon: true };
        }
        return { token: session.access_token, isAnon: false };
    } catch (e) {
        console.warn("[Gemini] Session fetch error, defaulting to Anon Key:", e);
        return { token: supabaseAnonKey, isAnon: true };
    }
};

/**
 * Exécute une requête via Supabase Edge Function
 */
export const executeEdgeFunction = async (
    action: 'generate' | 'stream',
    payload: any
): Promise<any> => {
    
    // 1. Get Fresh Token
    const { token: initialToken, isAnon } = await getFreshSessionToken();
    
    let response = await fetch(`${supabaseUrl}/functions/v1/gemini-api`, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${initialToken}`,
            'apikey': supabaseAnonKey
        },
        body: JSON.stringify({ ...payload, action })
    });

    // RETRY WITH ANON KEY ON 401 (If User Token failed)
    if (response.status === 401 && !isAnon) {
        console.log("[Gemini] User Token rejected (401). seamlessly switching to Anon Key...");
        response = await fetch(`${supabaseUrl}/functions/v1/gemini-api`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${supabaseAnonKey}`,
                'apikey': supabaseAnonKey
            },
            body: JSON.stringify({ ...payload, action })
        });
    }

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API Error ${response.status}: ${errText}`);
    }

    if (action === 'stream') {
        return response; // Return the raw response for streaming
    }

    return await response.json();
};

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

    const systemInstruction = SUPPORT_AGENT_PROMPT(context, user);
    
    const contents = history.map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.text }]
    }));
    contents.push({ role: 'user', parts: [{ text: userQuery }] });

    try {
        const response = await executeEdgeFunction('generate', {
            modelType: 'support', // Tell Edge Function to use support models
            contents,
            config: {
                systemInstruction: { parts: [{ text: systemInstruction }] },
                maxOutputTokens: 2000, 
                temperature: 0.5
            }
        });
        
        storageService.incrementSupportUsage();
        return response.candidates?.[0]?.content?.parts?.[0]?.text || "Je n'ai pas de réponse pour le moment.";
    } catch (e) {
        return "Désolé, je rencontre un problème technique momentané. Veuillez réessayer.";
    }
};

// 2. MAIN CHAT (STREAMING)
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

  const contents = history
    .filter(msg => msg.text && msg.text.trim().length > 0)
    .map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.text }]
    }));
  
  contents.push({ role: 'user', parts: [{ text: message }] });

  try {
      const response = await executeEdgeFunction('stream', {
          modelType: 'text', // Tell Edge Function to use text models
          contents,
          config: {
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT_TEMPLATE(user, user.preferences!) }] },
            temperature: 0.7,
            maxOutputTokens: 8192,
          }
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          if (chunk) yield chunk;
      }
      
      await creditService.deduct(user.id, CREDIT_COSTS.LESSON);

  } catch (e) {
      console.error("Stream exception:", e);
      yield "⚠️ Désolé, le service est temporairement indisponible. Veuillez réessayer dans un instant.";
  }
}

// 3. TEXT-TO-SPEECH (TTS) - AVEC FALLBACK SILENCIEUX
export const generateSpeech = async (text: string, voiceName: string = 'Kore', cost: number = CREDIT_COSTS.AUDIO_MESSAGE): Promise<ArrayBuffer | null> => {
    const user = await storageService.getCurrentUser();
    if (!user || !(await creditService.checkBalance(user.id, cost))) return null;

    try {
        const response = await executeEdgeFunction('generate', {
            modelType: 'audio', // Tell Edge Function to use audio models
            contents: [{ parts: [{ text: text }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: voiceName }
                    }
                }
            }
        });

        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!base64Audio) return null;

        await creditService.deduct(user.id, cost);

        const binaryString = atob(base64Audio);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer as ArrayBuffer;

    } catch (e) {
        console.warn("TTS Rotation Failed (Switching to Browser TTS):", e);
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
        const response = await executeEdgeFunction('generate', {
            modelType: 'text',
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            word: { type: Type.STRING },
                            translation: { type: Type.STRING },
                            example: { type: Type.STRING }
                        }
                    }
                }
            }
        });

        // Vocabulary extraction is free (included in lesson cost)
        const rawData = JSON.parse(response.candidates?.[0]?.content?.parts?.[0]?.text || "[]");
        
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
        const response = await executeEdgeFunction('generate', {
            modelType: 'text',
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            id: { type: Type.STRING },
                            type: { type: Type.STRING, enum: ["multiple_choice", "true_false", "fill_blank"] },
                            question: { type: Type.STRING },
                            options: { type: Type.ARRAY, items: { type: Type.STRING } },
                            correctAnswer: { type: Type.STRING },
                            explanation: { type: Type.STRING }
                        },
                        required: ["type", "question", "correctAnswer", "explanation"]
                    }
                }
            }
        });
        
        await creditService.deduct(user.id, CREDIT_COSTS.EXERCISE);
        return JSON.parse(response.candidates?.[0]?.content?.parts?.[0]?.text || "[]");
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
    const contents = history
        .filter(msg => msg.text && msg.text.trim().length > 0)
        .map(m => ({ role: m.role, parts: [{ text: m.text }] }));
    
    if (isClosing) contents.push({ role: 'user', parts: [{ text: "Evaluation finale" }] });

    try {
        const response = await executeEdgeFunction('generate', {
            modelType: 'text',
            contents: contents.length ? contents : [{role:'user', parts:[{text:'Start'}]}],
            config: {
                systemInstruction: { parts: [{ text: sysInstruct }] },
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        aiReply: { type: Type.STRING },
                        correction: { type: Type.STRING },
                        explanation: { type: Type.STRING },
                        score: { type: Type.NUMBER },
                        feedback: { type: Type.STRING }
                    },
                    required: ["aiReply"]
                }
            }
        });

        await creditService.deduct(user.id, CREDIT_COSTS.DIALOGUE_MESSAGE);
        return JSON.parse(response.candidates?.[0]?.content?.parts?.[0]?.text || "{}");
    } catch (e) {
        return { aiReply: "Problème technique (Rotation épuisée)." };
    }
};

export const generateNextLessonPrompt = (user: UserProfile): string => {
  return `IMPÉRATIF: Génère IMMÉDIATEMENT le contenu de la prochaine leçon.`;
};