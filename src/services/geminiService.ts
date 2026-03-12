/**
 * @file geminiService.improved.ts
 * @description Version améliorée du geminiService avec :
 * - Circuit Breaker
 * - Cache intelligent
 * - Gestion d'erreurs robuste
 * - Rate limiting
 * 
 * REMPLACER src/services/geminiService.ts par ce fichier
 */

import { UserProfile, ChatMessage, ExerciseItem } from "../types";
import { SYSTEM_PROMPT_TEMPLATE, SUPPORT_AGENT_PROMPT } from "../constants";
import { storageService } from "./storageService";
import { creditService, CREDIT_COSTS } from "./creditService";
import { geminiCircuitBreaker, ttsCircuitBreaker } from "./circuitBreaker";
import { cacheService } from "./cacheService";
import { errorService } from "./errorService";
import { toast } from "../components/Toaster";

// ── Clés API ──────────────────────────────────────────────────────────────────
// @ts-ignore
const RAW_KEYS: string[] = (import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '')
  .split(',').map((k: string) => k.trim()).filter(Boolean);

// ── Modèles ───────────────────────────────────────────────────────────────────
const TEXT_MODELS = [
  'gemini-3-flash-preview',
  'gemini-3-pro-preview',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
];

export const TEXT_MODEL = TEXT_MODELS[0];
export const AUDIO_MODEL = 'gemini-2.5-flash-preview-tts';
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

// ── Rotation des clés avec blacklist ─────────────────────────────────────────
let _keyIdx = 0;
const _deadKeys = new Set<string>(); // Clés inutilisables

function nextKey(): string {
  if (RAW_KEYS.length === 0) return '';
  
  // Essayer de trouver une clé vivante
  for (let i = 0; i < RAW_KEYS.length; i++) {
    const key = RAW_KEYS[_keyIdx % RAW_KEYS.length];
    _keyIdx++;
    
    if (!_deadKeys.has(key)) {
      return key;
    }
  }
  
  // Toutes les clés sont mortes, réinitialiser
  _deadKeys.clear();
  console.warn('[Gemini] Toutes les clés étaient blacklistées, réinitialisation');
  return RAW_KEYS[0];
}

function markKeyAsDead(key: string, reason: string) {
  _deadKeys.add(key);
  console.warn(`[Gemini] Clé blacklistée: ${key.slice(0, 10)}... (${reason})`);
  
  if (_deadKeys.size === RAW_KEYS.length) {
    toast.error('Toutes les clés API Gemini sont invalides. Contactez l\'admin.');
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── Appel Gemini avec circuit breaker ────────────────────────────────────────
async function callGemini(
  modelName: string,
  body: object,
  timeoutMs = 30_000,
  maxRetries = 2
): Promise<any> {
  // Utiliser le circuit breaker
  return geminiCircuitBreaker.execute(async () => {
    const modelsToTry = modelName === TEXT_MODEL
      ? TEXT_MODELS
      : [modelName, ...TEXT_MODELS];

    let lastErr = 'Erreur inconnue';

    for (const model of modelsToTry) {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const key = nextKey();
        if (!key) {
          errorService.logError(new Error('GEMINI_API_KEY manquant'), {
            context: 'Gemini:callGemini',
            severity: 'critical',
          });
          throw new Error('GEMINI_API_KEY manquant dans Render.');
        }

        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);

        try {
          const res = await fetch(`${BASE_URL}/${model}:generateContent?key=${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: ctrl.signal,
          });
          clearTimeout(timer);

          // Rate limit
          if (res.status === 429) {
            lastErr = `Rate limit (modèle ${model})`;
            await sleep(500 * (attempt + 1));
            continue;
          }

          // Clé invalide
          if (res.status === 401 || res.status === 403) {
            markKeyAsDead(key, `HTTP ${res.status}`);
            continue; // Essayer avec une autre clé
          }

          if (!res.ok) {
            const txt = await res.text().catch(() => '');
            lastErr = `${model} HTTP ${res.status}: ${txt.slice(0, 100)}`;
            
            errorService.logApiError(`Gemini:${model}`, new Error(lastErr), res.status);
            
            if (res.status === 400) break; // Bad request, ne pas retry
            await sleep(500 * (attempt + 1));
            continue;
          }

          const data = await res.json();
          console.log(`[Gemini] ✅ Réponse reçue (modèle: ${model})`);
          return data;

        } catch (e: any) {
          clearTimeout(timer);
          lastErr = e.name === 'AbortError'
            ? `Timeout ${timeoutMs / 1000}s (${model})`
            : e.message;

          errorService.logError(e, {
            context: `Gemini:callGemini:${model}`,
            severity: attempt === maxRetries ? 'high' : 'medium',
            metadata: { attempt, model },
          });

          if (attempt < maxRetries) await sleep(500 * (attempt + 1));
        }
      }
    }

    const error = new Error(`[Gemini] Toutes les tentatives échouées. Dernière erreur: ${lastErr}`);
    errorService.logError(error, {
      context: 'Gemini:callGemini',
      severity: 'critical',
    });
    throw error;
  });
}

// ── Construire le body de requête texte ───────────────────────────────────────
function buildBody(contents: any, config: Record<string, any> = {}): object {
  const { systemInstruction, ...genConfig } = config;

  const normalized = typeof contents === 'string'
    ? [{ role: 'user', parts: [{ text: contents }] }]
    : Array.isArray(contents) ? contents : [contents];

  const body: any = {
    contents: normalized,
    generationConfig: {
      maxOutputTokens: 8192,
      temperature: 0.7,
      ...genConfig,
    },
  };

  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  return body;
}

// ── Extraire le texte de la réponse ──────────────────────────────────────────
function extractText(data: any): string {
  if (!data?.candidates?.length) return '';
  const parts = data.candidates[0]?.content?.parts || [];
  return parts.map((p: any) => p.text || '').join('');
}

// ── Extraire et parser le JSON ────────────────────────────────────────────────
function extractJSON<T>(data: any): T | null {
  const raw = extractText(data);
  if (!raw) return null;
  try {
    const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(clean) as T;
  } catch {
    const match = raw.match(/[\[{][\s\S]*[\]}]/);
    if (match) {
      try { return JSON.parse(match[0]) as T; } catch { return null; }
    }
    return null;
  }
}

// ============================================================================
// 1. SUPPORT AGENT
// ============================================================================
export const generateSupportResponse = async (
  userQuery: string,
  context: string,
  user: UserProfile,
  history: { role: string; text: string }[]
): Promise<string> => {
  if (!storageService.canUseSupportAgent()) {
    return "⛔ Quota journalier d'aide atteint (100/100). Revenez demain.";
  }

  const prompt = history.length > 0
    ? `Historique:\n${history.map(h => `${h.role}: ${h.text}`).join('\n')}\n\nQuestion: ${userQuery}`
    : userQuery;

  try {
    const data = await callGemini(TEXT_MODEL, buildBody(prompt, {
      systemInstruction: SUPPORT_AGENT_PROMPT(context, user),
      maxOutputTokens: 2000,
      temperature: 0.5,
    }));

    storageService.incrementSupportUsage();
    return extractText(data) || "Je n'ai pas de réponse pour le moment.";
  } catch (e: any) {
    errorService.logError(e, {
      context: 'Gemini:Support',
      severity: 'medium',
    });
    return "Désolé, je rencontre un problème technique. Veuillez réessayer.";
  }
};

// ============================================================================
// 2. CHAT PRINCIPAL (AVEC CACHE)
// ============================================================================
export async function* sendMessageStream(
  message: string,
  user: UserProfile,
  history: ChatMessage[]
) {
  if (!user.preferences) {
    yield "⚠️ Profil incomplet. Veuillez configurer vos préférences.";
    return;
  }

  // ✅ VÉRIFIER LE CACHE D'ABORD
  const cacheKey = `${user.id}_${message.slice(0, 100)}_${history.slice(-3).map(m => m.text?.slice(0, 20)).join('_')}`;
  const cached = cacheService.getCachedGeminiResponse(cacheKey, user.id);
  
  if (cached) {
    console.log('[Gemini] 🎯 Réponse trouvée en cache');
    
    // Simuler streaming pour UX cohérente
    const chunkSize = 200;
    for (let i = 0; i < cached.length; i += chunkSize) {
      yield cached.slice(i, i + chunkSize);
      if (i + chunkSize < cached.length) await sleep(20);
    }
    
    // Crédits déjà déduits lors de la première requête
    return;
  }

  // ✅ VÉRIFIER LES CRÉDITS
  if (!(await creditService.checkBalance(user.id, CREDIT_COSTS.LESSON))) {
    yield "⛔ **Crédits épuisés.**\n\nVeuillez recharger votre compte pour continuer.";
    return;
  }

  try {
    console.log("[Gemini] Appel démarré. Modèle:", TEXT_MODEL);

    const recent = history.slice(-15)
      .filter(m => m.text?.trim())
      .map(m => `${m.role === 'user' ? 'Élève' : 'Professeur'}: ${m.text}`)
      .join('\n\n');

    const finalMessage = recent
      ? `Contexte précédent:\n${recent}\n\nNouveau message de l'élève: ${message}`
      : message;

    const data = await callGemini(TEXT_MODEL, buildBody(finalMessage, {
      systemInstruction: SYSTEM_PROMPT_TEMPLATE(user, user.preferences!),
      temperature: 0.7,
      maxOutputTokens: 8192,
    }));

    const text = extractText(data);

    if (!text) {
      yield "⚠️ Aucune réponse de l'IA. Veuillez réessayer.";
      return;
    }

    // ✅ METTRE EN CACHE LA RÉPONSE
    cacheService.cacheGeminiResponse(cacheKey, text, user.id);

    const chunkSize = 200;
    for (let i = 0; i < text.length; i += chunkSize) {
      yield text.slice(i, i + chunkSize);
      if (i + chunkSize < text.length) await sleep(20);
    }

    console.log("[Gemini] ✅ Réponse envoyée.");
    await creditService.deduct(user.id, CREDIT_COSTS.LESSON);

  } catch (e: any) {
    errorService.logError(e, {
      context: 'Gemini:Chat',
      severity: 'high',
      userId: user.id,
    });
    yield "⚠️ Désolé, le service est temporairement indisponible. Veuillez réessayer.";
  }
}

// ============================================================================
// 3. TEXT-TO-SPEECH (AVEC CIRCUIT BREAKER)
// ============================================================================

// ============================================================================
// 3. TEXT-TO-SPEECH — FIXED
// ✅ getLocalUser() synchrone (pas d'appel Supabase)
// ✅ -1 crédit à chaque clic (pas de cache — comportement voulu)
// ✅ Timeout 35s + retry 3x avec backoff
// ============================================================================
export const generateSpeech = async (
    text: string,
    voiceName: string = 'Kore',
    cost: number = CREDIT_COSTS.AUDIO_MESSAGE
): Promise<ArrayBuffer | null> => {

    // ✅ FIX: synchrone, pas d'appel réseau
    const user = storageService.getLocalUser();
    if (!user) return null;

    if (!(await creditService.checkBalance(user.id, cost))) {
        console.warn('[TTS] Crédits insuffisants');
        return null;
    }

    const cleanText = text
        .replace(/[#*`_~>]/g, '')
        .replace(/\[.*?\]/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, 800);

    if (!cleanText) return null;

    const ttsBody = {
        contents: [{ parts: [{ text: cleanText }] }],
        generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
                voiceConfig: {
                    prebuiltVoiceConfig: { voiceName }
                }
            }
        }
    };

    try {
        const result = await ttsCircuitBreaker.execute(async () => {
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    console.log(`[TTS] Tentative ${attempt}/3 — voix: ${voiceName}`);

                    const key = nextKey();
                    if (!key) throw new Error('GEMINI_API_KEY manquant');

                    const ctrl  = new AbortController();
                    const timer = setTimeout(() => ctrl.abort(), 35_000);

                    const res = await fetch(
                        `${BASE_URL}/${AUDIO_MODEL}:generateContent?key=${key}`,
                        {
                            method:  'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body:    JSON.stringify(ttsBody),
                            signal:  ctrl.signal,
                        }
                    );
                    clearTimeout(timer);

                    if (res.status === 429) {
                        console.warn(`[TTS] Rate limit (tentative ${attempt})`);
                        if (attempt < 3) await sleep(attempt * 1500);
                        continue;
                    }
                    if (res.status === 401 || res.status === 403) {
                        markKeyAsDead(key, `TTS HTTP ${res.status}`);
                        continue;
                    }
                    if (!res.ok) {
                        const errText = await res.text().catch(() => '');
                        throw new Error(`TTS HTTP ${res.status}: ${errText.slice(0, 150)}`);
                    }

                    const data        = await res.json();
                    const base64Audio = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

                    if (!base64Audio) {
                        throw new Error('Pas de données audio dans la réponse Gemini TTS');
                    }

                    const binaryString = atob(base64Audio);
                    const bytes        = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }

                    console.log(`[TTS] ✅ Succès tentative ${attempt} (${bytes.length} bytes)`);
                    return bytes.buffer as ArrayBuffer;

                } catch (e: any) {
                    if (e.name === 'AbortError') console.warn(`[TTS] Timeout tentative ${attempt}`);
                    if (attempt === 3) throw e;
                    await sleep(attempt * 1500);
                }
            }
            throw new Error('TTS échec après 3 tentatives');
        });

        // ✅ Déduire les crédits après succès (-1 à chaque clic, voulu)
        await creditService.deduct(user.id, cost);
        return result;

    } catch (e: any) {
        errorService.logError(e, {
            context:  'Gemini:TTS',
            severity: 'medium',
            userId:   user.id,
        });
        return null;
    }
};

// ============================================================================
// 4. VOCABULAIRE
// ============================================================================
export const extractVocabulary = async (history: ChatMessage[]): Promise<any[]> => {
  const user = await storageService.getCurrentUser();
  if (!user) return [];

  const context = history.slice(-6).map(m => `${m.role}: ${m.text}`).join('\n');
  const prompt = `Extrais 3 à 5 mots-clés vocabulaire de cette conversation.
Réponds UNIQUEMENT en JSON array: [{"word":"...","translation":"...","example":"..."}]

Conversation:\n${context}`;

  try {
    const data = await callGemini(TEXT_MODEL, buildBody(prompt, {
      maxOutputTokens: 1024, temperature: 0.3,
      responseMimeType: 'application/json',
    }));

    const result = extractJSON<any[]>(data);
    if (!Array.isArray(result)) return [];

    return result.map(item => ({
      id: crypto.randomUUID(),
      word: item.word || '',
      translation: item.translation || '',
      example: item.example || '',
      mastered: false,
      addedAt: Date.now(),
    }));
  } catch (e: any) {
    errorService.logError(e, {
      context: 'Gemini:ExtractVocabulary',
      severity: 'low',
    });
    return [];
  }
};

// ============================================================================
// 5. EXERCICES
// ============================================================================
export const generateExerciseFromHistory = async (
  history: ChatMessage[],
  user: UserProfile
): Promise<ExerciseItem[]> => {
  if (!(await creditService.checkBalance(user.id, CREDIT_COSTS.EXERCISE))) return [];

  const context = history.slice(-10).map(m => `${m.role}: ${m.text}`).join('\n');
  const prompt = `Génère 3 exercices variés (QCM ou Vrai/Faux) pour niveau ${user.preferences?.level} en ${user.preferences?.targetLanguage}.
Réponds UNIQUEMENT en JSON array:
[{"type":"multiple_choice","question":"...","options":["A","B","C","D"],"correct":"A","explanation":"..."}]

Conversation:\n${context}`;

  try {
    const data = await callGemini(TEXT_MODEL, buildBody(prompt, {
      maxOutputTokens: 2048, temperature: 0.4,
      responseMimeType: 'application/json',
    }));

    const result = extractJSON<ExerciseItem[]>(data);
    if (!Array.isArray(result)) return [];

    await creditService.deduct(user.id, CREDIT_COSTS.EXERCISE);
    return result.map((item: any, i: number) => ({ id: `ex_${i}_${Date.now()}`, ...item }));
  } catch (e: any) {
    errorService.logError(e, {
      context: 'Gemini:GenerateExercise',
      severity: 'medium',
    });
    return [];
  }
};

// ============================================================================
// 6. ROLEPLAY
// ============================================================================
export const generateRoleplayResponse = async (
  history: ChatMessage[],
  scenarioPrompt: string,
  user: UserProfile,
  isClosing = false,
  _isInitial = false
): Promise<{ aiReply: string; correction?: string; explanation?: string; score?: number; feedback?: string }> => {
  if (!(await creditService.checkBalance(user.id, CREDIT_COSTS.DIALOGUE_MESSAGE))) {
    return { aiReply: "⚠️ Crédits insuffisants." };
  }

  const sys = `Tu es partenaire de jeu de rôle en ${user.preferences?.targetLanguage} (niveau ${user.preferences?.level}). Scénario: ${scenarioPrompt}. Réponds en JSON: {"aiReply":"...","correction":"...","explanation":"...","score":0-100,"feedback":"..."}`;

  const ctx = history.filter(m => m.text?.trim()).map(m => `${m.role}: ${m.text}`).join('\n');
  const prompt = isClosing ? `${ctx}\n\nFais l'évaluation finale.` : (ctx || "Commence.");

  try {
    const data = await callGemini(TEXT_MODEL, buildBody(prompt, {
      systemInstruction: sys, temperature: 0.6,
      responseMimeType: 'application/json',
    }));

    const result = extractJSON<any>(data);
    if (!result) return { aiReply: "Continuons la conversation." };

    await creditService.deduct(user.id, CREDIT_COSTS.DIALOGUE_MESSAGE);
    return result;
  } catch (e: any) {
    errorService.logError(e, {
      context: 'Gemini:Roleplay',
      severity: 'medium',
    });
    return { aiReply: "Problème technique. Veuillez réessayer." };
  }
};

// ============================================================================
// 7. TEXTE GÉNÉRIQUE
// ============================================================================
export const generateText = async (prompt: string): Promise<string> => {
  try {
    const data = await callGemini(TEXT_MODEL, buildBody(prompt, { maxOutputTokens: 4096 }));
    return extractText(data);
  } catch (e: any) {
    errorService.logError(e, {
      context: 'Gemini:GenerateText',
      severity: 'low',
    });
    return '';
  }
};
