import { Type, Modality } from "@google/genai";
import { UserProfile, ChatMessage, VocabularyItem, ExerciseItem } from "../types";
import { SYSTEM_PROMPT_TEMPLATE, SUPPORT_AGENT_PROMPT } from "../constants";
import { storageService } from "./storageService";
import { creditService, CREDIT_COSTS } from "./creditService";
import { supabase } from "../lib/supabase";

// --- CONFIGURATION DE LA ROTATION ---

// Ordre de priorité des modèles (Textes & Raisonnement)
export const TEXT_MODELS = [
    'gemini-3-flash-preview',
    'gemini-3.1-pro-preview',
    'gemini-flash-latest',
    'gemini-flash-lite-latest',
    'gemini-2.0-flash-exp'
];

// Ordre de priorité des modèles (Support / Tâches simples)
const SUPPORT_MODELS = [
    'gemini-flash-lite-latest',
    'gemini-flash-latest',
    'gemini-3-flash-preview'
];

// Ordre de priorité des modèles (Audio / TTS)
const AUDIO_MODELS = [
    'gemini-2.5-flash-preview-tts',
    'gemini-2.5-flash-preview-tts',
    'gemini-2.5-flash-preview-tts' // Retry same model multiple times
];

// Ordre de priorité des modèles (Live Audio)
export const LIVE_MODELS = [
    'gemini-2.5-flash-native-audio-preview-09-2025',
    'gemini-2.0-flash-exp',
    'gemini-2.0-flash-lite-preview-02-05'
];

// --- MOTEUR DE ROTATION INTELLIGENT ---

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Exécute une requête standard (non-streaming) via Supabase Edge Function :
 * 1. Itère sur chaque MODÈLE de la liste.
 * 2. Appelle la fonction Edge (qui gère la rotation des clés).
 */
export const executeWithRotation = async (
    modelList: string[], 
    requestPayloadFn: (model: string) => any
): Promise<any> => {
    let lastError;

    // ROTATION NIVEAU 2 : MODÈLES
    for (const model of modelList) {
        // Retry loop for 5xx errors or transient network issues
        for (let attempt = 0; attempt < 3; attempt++) { // Increased retries to 3
            try {
                const payload = requestPayloadFn(model);
                
                const { data, error } = await supabase.functions.invoke('gemini-api?action=generate', {
                    body: payload
                });

                if (error) {
                    throw new Error(error.message || `Server error`);
                }

                return data; // Succès immédiat

            } catch (e: any) {
                const isQuota = e.message?.includes("429") || e.message?.includes("403");
                const isServer = e.message?.includes("500");
                const isNetwork = e.message?.includes("Failed to fetch") || e.name === 'TypeError';
                
                // Only log warnings for the first few failures to avoid console spam
                if (attempt === 0) {
                        console.warn(
                        `⚠️ Echec [Model: ${model}] - ${isQuota ? 'QUOTA/RATE' : isServer ? 'SERVER ERROR' : isNetwork ? 'NETWORK ERROR' : e.message}`
                    );
                }
                
                if (isQuota) {
                    await sleep(2000 + Math.random() * 3000); // Increased backoff 2-5s
                    lastError = e;
                    break; // Break retry loop, move to next model immediately
                }

                if (isServer || isNetwork) {
                    await sleep(1000 * (attempt + 1)); // Exponential backoff: 1s, 2s, 3s
                    lastError = e;
                    continue; // Retry same model
                }

                lastError = e;
                break; // Non-retriable error, move to next model
            }
        }
    }

    // Si on arrive ici, tout a échoué.
    console.error("🔥 CRITICAL: All models exhausted.");
    throw lastError || new Error("Service temporairement indisponible (Rotation épuisée).");
};

/**
 * Exécute une requête de streaming via Supabase Edge Function.
 */
async function* streamWithRotation(
    modelList: string[],
    requestPayloadFn: (model: string) => any
) {
    for (const model of modelList) {
        try {
            const payload = requestPayloadFn(model);
            
            // supabase.functions.invoke does not support streaming responses directly yet
            // We need to use fetch with the supabase anon key
            const { data: { session } } = await supabase.auth.getSession();
            const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL;
            const supabaseKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY;
            
            const response = await fetch(`${supabaseUrl}/functions/v1/gemini-api?action=stream`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session?.access_token || supabaseKey}`,
                    'apikey': supabaseKey
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok || !response.body) {
                 throw new Error(`Stream error: ${response.status}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                yield decoder.decode(value, { stream: true });
            }
            
            return; // Succès total

        } catch (e: any) {
            console.warn(`⚠️ Stream Fail [Model: ${model}]`, e);
            continue; // Modèle suivant
        }
    }

    // Fallback ultime si tout échoue
    yield "⚠️ Désolé, le service est saturé. Veuillez réessayer dans un instant.";
}

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
        const response = await executeWithRotation(SUPPORT_MODELS, (model) => ({
            model,
            contents,
            config: {
                systemInstruction: { parts: [{ text: systemInstruction }] }, // Fix format for API
                maxOutputTokens: 2000, 
                temperature: 0.5
            }
        }));
        
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

  const streamGenerator = streamWithRotation(TEXT_MODELS, (model) => ({
      model,
      contents,
      config: {
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT_TEMPLATE(user, user.preferences!, user.aiMemory) }] },
        temperature: 0.7,
        maxOutputTokens: 8192,
      }
  }));

  let hasYielded = false;
  for await (const chunk of streamGenerator) {
      if (chunk) {
          yield chunk;
          if (!chunk.startsWith('⚠️')) hasYielded = true;
      }
  }

  if (hasYielded) {
      await creditService.deduct(user.id, CREDIT_COSTS.LESSON);
  }
}

// 3. TEXT-TO-SPEECH (TTS) - AVEC FALLBACK SILENCIEUX
export const generateSpeech = async (text: string, voiceName: string = 'Kore', cost: number = CREDIT_COSTS.AUDIO_MESSAGE): Promise<ArrayBuffer | null> => {
    const user = await storageService.getCurrentUser();
    if (!user || !(await creditService.checkBalance(user.id, cost))) return null;

    try {
        const response = await executeWithRotation(AUDIO_MODELS, (model) => ({
            model,
            contents: [{ parts: [{ text: text }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: voiceName }
                    }
                }
            }
        }));

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
export const extractVocabulary = async (history: ChatMessage[]): Promise<VocabularyItem[]> => {
    const user = await storageService.getCurrentUser();
    if (!user) return [];

    const context = history.slice(-6).map(m => `${m.role}: ${m.text}`).join('\n');
    const prompt = `Based on the following conversation, extract 3 to 5 key vocabulary words. Return JSON array [{word, translation, example}].\n${context}`;

    try {
        const response = await executeWithRotation(TEXT_MODELS, (model) => ({
            model,
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
        }));

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
        const response = await executeWithRotation(TEXT_MODELS, (model) => ({
            model,
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
        }));
        
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
        const response = await executeWithRotation(TEXT_MODELS, (model) => ({
            model,
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
        }));

        await creditService.deduct(user.id, CREDIT_COSTS.DIALOGUE_MESSAGE);
        return JSON.parse(response.candidates?.[0]?.content?.parts?.[0]?.text || "{}");
    } catch (e) {
        return { aiReply: "Problème technique (Rotation épuisée)." };
    }
};

export const generateNextLessonPrompt = (user: UserProfile): string => {
  const nextLessonNum = (user.stats.lessonsCompleted || 0) + 1;
  return `IMPÉRATIF: Génère IMMÉDIATEMENT le contenu de la Leçon ${nextLessonNum}.`;
};