import { GoogleGenAI, Type, Modality } from "@google/genai";
import { UserProfile, ChatMessage, ExerciseItem } from "../types";
import { SYSTEM_PROMPT_TEMPLATE, SUPPORT_AGENT_PROMPT } from "../constants";
import { storageService } from "./storageService";
import { creditService, CREDIT_COSTS } from "./creditService";

// --- CLIENT GEMINI DIRECT ---
// Utilisation directe du SDK GoogleGenAI pour une stabilité et rapidité maximales.
// Plus de proxy, plus d'erreurs 500, plus de problèmes de JWT.

export const getAiClient = () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error("[Gemini] Critical: Missing GEMINI_API_KEY environment variable");
        throw new Error("Clé API Gemini manquante.");
    }
    return new GoogleGenAI({ apiKey });
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
        const ai = getAiClient();
        const systemInstruction = SUPPORT_AGENT_PROMPT(context, user);
        
        const chat = ai.chats.create({
            model: TEXT_MODEL,
            config: {
                systemInstruction: systemInstruction,
                maxOutputTokens: 2000, 
                temperature: 0.5
            }
        });

        // Rejouer l'historique si nécessaire (simplifié pour la stabilité)
        // Pour plus de stabilité, on envoie juste le dernier message avec le contexte
        const prompt = `Historique de conversation:\n${history.map(h => `${h.role}: ${h.text}`).join('\n')}\n\nQuestion actuelle: ${userQuery}`;

        const response = await chat.sendMessage({ message: prompt });
        
        storageService.incrementSupportUsage();
        return response.text || "Je n'ai pas de réponse pour le moment.";
    } catch (e) {
        console.error("Support error:", e);
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

  try {
      const ai = getAiClient();
      
      const chat = ai.chats.create({
          model: TEXT_MODEL,
          config: {
              systemInstruction: SYSTEM_PROMPT_TEMPLATE(user, user.preferences!),
              temperature: 0.7,
              maxOutputTokens: 8192,
          }
      });

      // Format history for the prompt to ensure stability
      const contextPrompt = history
        .filter(msg => msg.text && msg.text.trim().length > 0)
        .map(msg => `${msg.role === 'user' ? 'Élève' : 'Professeur'}: ${msg.text}`)
        .join('\n\n');

      const finalMessage = contextPrompt ? `Contexte précédent:\n${contextPrompt}\n\nNouveau message de l'élève: ${message}` : message;

      const responseStream = await chat.sendMessageStream({ message: finalMessage });

      for await (const chunk of responseStream) {
          const c = chunk as any;
          if (c.text) yield c.text;
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
        const ai = getAiClient();
        const response = await ai.models.generateContent({
            model: AUDIO_MODEL,
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
        console.warn("TTS Failed (Switching to Browser TTS):", e);
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
        const ai = getAiClient();
        const response = await ai.models.generateContent({
            model: TEXT_MODEL,
            contents: prompt,
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

        const rawData = JSON.parse(response.text || "[]");
        
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
        const ai = getAiClient();
        const response = await ai.models.generateContent({
            model: TEXT_MODEL,
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            id: { type: Type.STRING },
                            type: { type: Type.STRING },
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
        return JSON.parse(response.text || "[]");
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
        const ai = getAiClient();
        const response = await ai.models.generateContent({
            model: TEXT_MODEL,
            contents: finalPrompt,
            config: {
                systemInstruction: sysInstruct,
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
        return JSON.parse(response.text || "{}");
    } catch (e) {
        return { aiReply: "Problème technique." };
    }
};

// 7. GENERIC TEXT GENERATION (e.g., for translation)
export const generateText = async (prompt: string): Promise<string> => {
    try {
        const ai = getAiClient();
        const response = await ai.models.generateContent({
            model: TEXT_MODEL,
            contents: prompt
        });
        return response.text || "";
    } catch (e) {
        console.error("generateText error:", e);
        return "";
    }
};