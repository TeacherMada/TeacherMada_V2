
import { GoogleGenAI, Type } from "@google/genai";
import { UserProfile } from "../../types";
import { SmartExam, ExamResultDetailed, CertificateMetadata, ExamType } from "./types";
import { storageService } from "../../services/storageService";
import { executeWithRotation, TEXT_MODELS } from "../../services/geminiService";
import { creditService, CREDIT_COSTS } from "../../services/creditService";

export const SmartExamService = {
    
    async checkBalance(userId: string, type: ExamType): Promise<boolean> {
        const cost = type === 'certification' ? CREDIT_COSTS.EXAM : CREDIT_COSTS.DIAGNOSTIC;
        return await creditService.checkBalance(userId, cost);
    },

    async startExam(user: UserProfile, type: ExamType): Promise<SmartExam | null> {
        if (!user || !user.id) return null;
        const cost = type === 'certification' ? CREDIT_COSTS.EXAM : CREDIT_COSTS.DIAGNOSTIC;
        
        // 1. Deduct Credits
        const success = await creditService.deduct(user.id, cost);
        if (!success) return null;

        const level = user.preferences?.level || 'A1';
        const lang = user.preferences?.targetLanguage || 'Anglais';
        const difficulties = user.aiMemory?.currentDifficulties?.join(', ') || 'Aucune difficulté majeure';

        try {
            // 2. Generate Exam
            const prompt = `
            Génère un examen de certification de type "${type}" pour l'étudiant "${user.username}" (Langue cible : "${lang}").
            L'examen doit être rigoureux, professionnel et cibler ses difficultés récentes : ${difficulties}.
            
            IMPORTANT : L'examen doit être STRICTEMENT adapté au niveau cible "${level}".
            Ne PAS inclure de questions d'un niveau supérieur (par exemple, pas de B1/B2 si le niveau cible est A1).
            La difficulté doit être progressive AU SEIN du niveau ${level} :
            - Questions 1 à 5 : Facile (Début de niveau ${level})
            - Questions 6 à 10 : Moyen (Milieu de niveau ${level})
            - Questions 11 à 15 : Difficile (Fin de niveau ${level})
            - Questions 16 à 20 : Très difficile (Test limite du niveau ${level})
            
            Structure requise (JSON) : 20 questions au total.
            - 5 questions de Compréhension Orale (Listening) - Fournir le texte dans 'context' (il sera lu par synthèse vocale et caché à l'étudiant).
            - 5 questions de Compréhension Écrite/Grammaire (QCM) - Variez absolument les formats : Choix multiples, Vrai ou Faux, Phrases à compléter.
            - 5 questions d'Expression Écrite (Writing) - Sujets variés (phrases, paragraphes).
            - 5 questions d'Expression Orale (Speaking) - Mises en situation.
            
            Output JSON Schema:
            {
                "sections": [
                    { "id": "l1", "type": "listening", "question": "Écoutez l'audio et répondez à la question.", "context": "Texte secret à lire...", "options": ["A", "B", "C", "D"], "weight": 2 },
                    { "id": "q1", "type": "qcm", "question": "...", "options": ["A", "B", "C", "D"], "weight": 1 },
                    { "id": "w1", "type": "writing", "question": "...", "weight": 3 },
                    { "id": "s1", "type": "speaking", "question": "...", "weight": 3 }
                ]
            }
            `;

            const response = await executeWithRotation(TEXT_MODELS, async (ai, model) => {
                return await ai.models.generateContent({
                    model,
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    config: {
                        responseMimeType: "application/json",
                        responseSchema: {
                            type: Type.OBJECT,
                            properties: {
                                sections: {
                                    type: Type.ARRAY,
                                    items: {
                                        type: Type.OBJECT,
                                        properties: {
                                            id: { type: Type.STRING },
                                            type: { type: Type.STRING, enum: ["qcm", "writing", "speaking", "listening"] },
                                            question: { type: Type.STRING },
                                            context: { type: Type.STRING },
                                            options: { type: Type.ARRAY, items: { type: Type.STRING } },
                                            weight: { type: Type.NUMBER }
                                        },
                                        required: ["id", "type", "question", "weight"]
                                    }
                                }
                            }
                        }
                    }
                });
            });

            const data = JSON.parse(response.text || "{}");
            
            if (!data.sections || !Array.isArray(data.sections) || data.sections.length === 0) {
                throw new Error("Format d'examen invalide (Sections manquantes)");
            }

            return {
                id: crypto.randomUUID(),
                type,
                targetLevel: level,
                language: lang,
                sections: data.sections,
                totalQuestions: data.sections.length,
                createdAt: Date.now()
            };

        } catch (e) {
            console.error("Exam Gen Error", e);
            // Rollback credits
            await storageService.addCredits(user.id, cost);
            return null;
        }
    },

    async evaluateExam(exam: SmartExam, answers: Record<string, string>, user: UserProfile): Promise<ExamResultDetailed> {
        const prompt = `
        En tant que TeacherMada (Professeur expert, strict mais bienveillant), évalue cet examen de certification pour l'étudiant "${user.username}".
        Langue évaluée : ${exam.language}.
        Niveau visé par l'examen : ${exam.targetLevel}.
        
        Questions & Réponses :
        ${exam.sections.map(s => `[${s.type.toUpperCase()}] Q: ${s.question} \n R: ${answers[s.id] ? answers[s.id] : "AUCUNE RÉPONSE (Temps écoulé ou ignoré)"}`).join('\n\n')}
        
        Tâche :
        1. Analyse la grammaire, le vocabulaire, la cohérence de manière très stricte et professionnelle.
        2. Estime le niveau RÉEL (CEFR) basé sur la performance globale.
           - IMPORTANT : Si le score est inférieur à 70/100, le niveau détecté NE PEUT PAS être supérieur au niveau visé (${exam.targetLevel}). Il doit être "Inférieur à ${exam.targetLevel}" ou le niveau en dessous.
           - Si le score est élevé (> 80), tu peux estimer un niveau supérieur si le vocabulaire le justifie.
        3. Calcule un score sur 100 (sois exigeant, les fautes de base pénalisent lourdement).
           - Si "AUCUNE RÉPONSE", comptez 0 pour cette question.
        4. Donne un feedback constructif et professionnel. 
           - Si l'étudiant réussit (>= 70), félicite-le de manière formelle.
           - Si l'étudiant échoue (< 70), donne-lui du courage, des recommandations précises et un plan d'action concret étape par étape pour s'améliorer.
           - RECOMMANDATIONS CIBLÉES :
             * Si la grammaire/vocabulaire est faible : Recommande de "renforcer les bases via le Chat interactif".
             * Si l'expression orale/écoute est faible : Recommande de "pratiquer l'oral via l'Appel Vocal (TeacherMada Live)".
             * Si tout est moyen : Recommande les "Jeux de Rôle" pour la mise en situation.
           - FORMAT DU FEEDBACK : Le texte DOIT être aéré. Utilise le caractère spécial '\\n' pour faire des sauts de ligne dans la chaîne JSON. Ne mets pas tout sur une seule ligne.
        5. Ne mentionne jamais que tu es une IA ou un robot. Parle en tant que "TeacherMada, Directeur Pédagogique".
        
        Output JSON.
        `;

        try {
            const response = await executeWithRotation(TEXT_MODELS, async (ai, model) => {
                return await ai.models.generateContent({
                    model,
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    config: {
                        responseMimeType: "application/json",
                        responseSchema: {
                            type: Type.OBJECT,
                            properties: {
                                globalScore: { type: Type.NUMBER },
                                skillScores: {
                                    type: Type.OBJECT,
                                    properties: {
                                        reading: { type: Type.NUMBER },
                                        writing: { type: Type.NUMBER },
                                        listening: { type: Type.NUMBER },
                                        speaking: { type: Type.NUMBER }
                                    }
                                },
                                detectedLevel: { type: Type.STRING },
                                feedback: { type: Type.STRING },
                                confidenceScore: { type: Type.NUMBER }
                            }
                        }
                    }
                });
            });

            const evalData = JSON.parse(response.text || "{}");
            const passed = (evalData.globalScore || 0) >= 70; // Seuil strict

            let certId = undefined;
            if (exam.type === 'certification' && passed) {
                certId = `CERT-${Date.now().toString(36).toUpperCase()}-${user.id.slice(0,4).toUpperCase()}`;
                // Save Cert
                await storageService.saveCertificate({
                    id: certId,
                    userId: user.id,
                    userName: user.username,
                    userFullName: user.fullName || user.username, // Use full name
                    language: user.preferences?.targetLanguage || "Inconnu",
                    level: exam.targetLevel,
                    examId: exam.id,
                    issueDate: Date.now(),
                    validationHash: certId, // Placeholder for now
                    qrCodeData: certId,
                    score: evalData.globalScore,
                    globalScore: evalData.globalScore,
                    skillScores: evalData.skillScores
                });

                // Notification
                await storageService.createNotification({
                    userId: user.id,
                    type: 'achievement',
                    title: 'Certification Validée !',
                    message: `Félicitations ! Vous avez obtenu le certificat ${exam.targetLevel} en ${user.preferences?.targetLanguage}.`,
                    data: { certificateId: certId } // Make clickable
                });
            } else if (exam.type === 'certification' && !passed) {
                 // Notification Echec
                 await storageService.createNotification({
                    userId: user.id,
                    type: 'system',
                    title: 'Résultat Examen',
                    message: `Examen terminé. Score: ${evalData.globalScore}/100. Courage, continuez vos efforts !`,
                    data: { examId: exam.id } // Make clickable to see details
                });
            }

            const resultDetailed: ExamResultDetailed = {
                examId: exam.id,
                userId: user.id,
                userName: user.username,
                userFullName: user.fullName || user.username, // Use full name
                language: exam.language,
                date: Date.now(),
                globalScore: evalData.globalScore || 0,
                skillScores: evalData.skillScores || { reading: 0, writing: 0, listening: 0, speaking: 0 },
                detectedLevel: evalData.detectedLevel || "Inconnu",
                passed,
                certificateId: certId,
                feedback: evalData.feedback || "Analyse incomplète.",
                confidenceScore: evalData.confidenceScore || 80
            };

            // SAVE EXAM RESULT TO HISTORY (Passed or Failed)
            await storageService.saveExamResult({
                id: exam.id,
                userId: user.id,
                language: exam.language,
                level: exam.targetLevel,
                score: resultDetailed.globalScore,
                totalQuestions: exam.totalQuestions,
                passed: resultDetailed.passed,
                date: resultDetailed.date,
                details: resultDetailed
            });

            return resultDetailed;

        } catch (e) {
            console.error("Eval Error", e);
            throw new Error("Erreur lors de la correction.");
        }
    }
};
