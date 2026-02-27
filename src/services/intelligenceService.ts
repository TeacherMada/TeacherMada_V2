import { Type } from "@google/genai";
import { UserProfile, ChatMessage, LearningProfile, LearningMemory } from "../types";
import { executeWithRotation, TEXT_MODELS } from "./geminiService";
import { storageService } from "./storageService";

export const intelligenceService = {
    /**
     * Analyze recent conversation history to update the user's LearningProfile (Scores).
     * This runs periodically to give feedback on performance.
     */
    analyzePerformance: async (user: UserProfile, history: ChatMessage[]): Promise<LearningProfile | null> => {
        const userMessages = history.filter(m => m.role === 'user');
        if (userMessages.length < 3) return user.learningProfile || null;

        const now = Date.now();
        // Debounce: Only analyze every 5 minutes
        if (user.learningProfile && (now - user.learningProfile.lastAnalysisTimestamp < 5 * 60 * 1000)) {
            return user.learningProfile;
        }

        const context = history.slice(-15).map(m => `${m.role}: ${m.text}`).join('\n');
        const targetLang = user.preferences?.targetLanguage || 'la langue cible';
        const level = user.preferences?.level || 'A1';

        const prompt = `
        Tu es un expert en évaluation linguistique.
        Analyse cette conversation (${targetLang}, Niveau ${level}).
        
        Donne un score (0-100) pour:
        - Prononciation (basé sur l'orthographe/phonétique)
        - Grammaire
        - Vocabulaire
        - Fluidité
        - Structure

        Identifie 2-3 points forts et faibles.
        
        Conversation:
        ${context}
        `;

        try {
            const response = await executeWithRotation(TEXT_MODELS, (model) => ({
                model,
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            pronunciation: { type: Type.NUMBER },
                            grammar: { type: Type.NUMBER },
                            vocabulary: { type: Type.NUMBER },
                            fluency: { type: Type.NUMBER },
                            structure: { type: Type.NUMBER },
                            strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
                            weaknesses: { type: Type.ARRAY, items: { type: Type.STRING } }
                        },
                        required: ["pronunciation", "grammar", "vocabulary", "fluency", "structure", "strengths", "weaknesses"]
                    }
                }
            }));

            const data = JSON.parse(response.candidates?.[0]?.content?.parts?.[0]?.text || "{}");
            const overall = Math.round((data.pronunciation + data.grammar + data.vocabulary + data.fluency + data.structure) / 5);

            const newProfile: LearningProfile = {
                brainScore: { ...data, overall },
                strengths: data.strengths || [],
                weaknesses: data.weaknesses || [],
                lastAnalysisTimestamp: now
            };

            const updatedUser = { ...user, learningProfile: newProfile };
            await storageService.saveUserProfile(updatedUser);
            return newProfile;

        } catch (error) {
            console.error("Performance analysis failed:", error);
            return user.learningProfile || null;
        }
    },

    /**
     * Deep analysis to update Long-Term Memory (Vocabulary, Errors, Concepts).
     * Should be called at the end of a session or every ~20 messages.
     */
    consolidateMemory: async (user: UserProfile, history: ChatMessage[]): Promise<LearningMemory | null> => {
        const userMessages = history.filter(m => m.role === 'user');
        if (userMessages.length < 5) return user.aiMemory || null;

        // Initialize memory if missing
        const currentMemory: LearningMemory = user.aiMemory || {
            masteredVocabulary: [],
            frequentErrors: [],
            completedConcepts: [],
            currentDifficulties: [],
            lastLesson: "Introduction",
            weeklyGoal: "Découverte",
            successRate: 100,
            lastUpdate: 0
        };

        const now = Date.now();
        // Debounce: Only consolidate every 10 minutes
        if (now - (currentMemory.lastUpdate || 0) < 10 * 60 * 1000) {
            return currentMemory;
        }

        const context = history.slice(-30).map(m => `${m.role}: ${m.text}`).join('\n');
        const targetLang = user.preferences?.targetLanguage;

        const prompt = `
        Mets à jour le profil d'apprentissage de l'élève (${targetLang}).
        
        Mémoire Actuelle:
        - Vocabulaire acquis: ${currentMemory.masteredVocabulary.join(', ')}
        - Erreurs fréquentes: ${currentMemory.frequentErrors.join(', ')}
        - Difficultés: ${currentMemory.currentDifficulties.join(', ')}
        
        Conversation Récente:
        ${context}
        
        TACHE:
        1. Ajoute les NOUVEAUX mots de vocabulaire correctement utilisés (max 5).
        2. Identifie les erreurs persistantes (max 3).
        3. Note les concepts grammaticaux qui semblent acquis.
        4. Mets à jour les difficultés actuelles.
        5. Détermine le sujet de la dernière leçon/discussion.
        6. Estime le taux de réussite global sur cette session (0-100).

        Retourne un JSON mis à jour.
        `;

        try {
            const response = await executeWithRotation(TEXT_MODELS, (model) => ({
                model,
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            newMasteredVocabulary: { type: Type.ARRAY, items: { type: Type.STRING } },
                            newFrequentErrors: { type: Type.ARRAY, items: { type: Type.STRING } },
                            newCompletedConcepts: { type: Type.ARRAY, items: { type: Type.STRING } },
                            currentDifficulties: { type: Type.ARRAY, items: { type: Type.STRING } },
                            lastLessonTopic: { type: Type.STRING },
                            sessionSuccessRate: { type: Type.NUMBER }
                        }
                    }
                }
            }));

            const data = JSON.parse(response.candidates?.[0]?.content?.parts?.[0]?.text || "{}");

            // Merge logic
            const newMemory: LearningMemory = {
                masteredVocabulary: Array.from(new Set([...currentMemory.masteredVocabulary, ...(data.newMasteredVocabulary || [])])).slice(-50), // Keep last 50
                frequentErrors: Array.from(new Set([...(data.newFrequentErrors || []), ...currentMemory.frequentErrors])).slice(0, 10), // Keep top 10 recent
                completedConcepts: Array.from(new Set([...currentMemory.completedConcepts, ...(data.newCompletedConcepts || [])])),
                currentDifficulties: data.currentDifficulties || currentMemory.currentDifficulties,
                lastLesson: data.lastLessonTopic || currentMemory.lastLesson,
                weeklyGoal: currentMemory.weeklyGoal, // Keep existing goal for now
                successRate: Math.round((currentMemory.successRate + (data.sessionSuccessRate || 80)) / 2), // Moving average
                lastUpdate: now
            };

            const updatedUser = { ...user, aiMemory: newMemory };
            await storageService.saveUserProfile(updatedUser);
            return newMemory;

        } catch (error) {
            console.error("Memory consolidation failed:", error);
            return currentMemory;
        }
    }
};
