/**
 * ============================================================================
 * TeacherMada — geminiService.ts v3.0 (DIRECT API — ULTRA RAPIDE)
 * ============================================================================
 * Architecture : Frontend → Gemini API directement (pas de Edge Function)
 * Sécurité     : Clé restreinte par domaine dans Google Cloud Console
 * Crédits      : Toujours vérifiés côté Supabase (RPC consume_credits_safe)
 * Performance  : ~500ms vs ~2-3s avec Edge Function
 * ============================================================================
 */

import { UserProfile, ChatMessage, ExerciseItem } from "../types";
import { SYSTEM_PROMPT_TEMPLATE, SUPPORT_AGENT_PROMPT } from "../constants";
import { storageService } from "./storageService";
import { creditService, CREDIT_COSTS } from "./creditService";

// ── Clés API depuis les variables d'environnement Render (VITE_) ──────────────
// Ces clés sont dans le bundle JS mais protégées par restriction de domaine
// dans Google Cloud Console → Credentials → API Key → Application restrictions
//const RAW_KEYS = (import.meta.env.VITE_GEMINI_API_KEY || '').split(',').map((k: string) => k.trim()).filter(Boolean);
// @ts-ignore
const RAW_KEYS = (import.meta.env.VITE_GEMINI_API_KEY || '').split(',').map((k: string) => k.trim()).filter(Boolean);
console.log('[Gemini] Clés chargées:', RAW_KEYS.length, 'clé(s)');
// ── Modèles (du plus rapide au plus puissant) ─────────────────────────────────
export const TEXT_MODEL         = 'gemini-2.5-flash';            // Rapide et fiable
export const TEXT_MODEL_PRO     = 'gemini-3.1-flash-preview'; // Plus puissant
export const AUDIO_MODEL        = 'gemini-2.5-flash-preview-tts';
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

// ── Sélection de clé avec rotation (évite les limites de rate) ───────────────
let keyIndex = 0;
function nextKey(): string {
  if (RAW_KEYS.length === 0) {
    console.error('[Gemini] VITE_GEMINI_API_KEY non configuré dans Render !');
    return '';
  }
  const key = RAW_KEYS[keyIndex % RAW_KEYS.length];
  keyIndex++;
  return key;
}

// ── Fetch Gemini avec retry automatique sur 429 et timeout ───────────────────
async function geminiPost(
  endpoint: string,
  body: object,
  timeoutMs: number = 25_000,
  maxRetries: number = 2
): Promise<any> {
  let lastError = '';

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const key = nextKey();
    if (!key) throw new Error('Clé Gemini manquante. Vérifiez VITE_GEMINI_API_KEY dans Render.');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${BASE_URL}/${endpoint}?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);

      // Rate limit → rotation de clé + backoff
      if (res.status === 429) {
        lastError = `Rate limit clé ${attempt + 1}/${maxRetries + 1}`;
        console.warn(`[Gemini] ${lastError}, rotation...`);
        await sleep(400 * (attempt + 1));
        continue;
      }

      // Erreur non récupérable
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        lastError = `Gemini API ${res.status}: ${errText.slice(0, 150)}`;
        if (res.status === 400 || res.status === 404) {
          throw new Error(lastError);
        }
        if (attempt < maxRetries) {
          await sleep(600 * (attempt + 1));
          continue;
        }
        throw new Error(lastError);
      }

      return await res.json();

    } catch (e: any) {
      clearTimeout(timer);
      if (e.name === 'AbortError') {
        lastError = `Timeout ${timeoutMs / 1000}s`;
      } else if (e.message !== lastError) {
        lastError = e.message;
      }
      if (attempt < maxRetries) {
        console.warn(`[Gemini] Tentative ${attempt + 1} échouée (${lastError}), retry...`);
        await sleep(600 * (attempt + 1));
        continue;
      }
    }
  }

  throw new Error(`[Gemini] Toutes les tentatives échouées: ${lastError}`);
}

// ── Helper : construire le body generateContent ───────────────────────────────
function buildGenerateBody(
  contents: any,
  config: Record<string, any> = {}
): object {
  const { systemInstruction, ...genConfig } = config;

  const body: any = {
    contents: normalizeContents(contents),
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

function normalizeContents(contents: any): any[] {
  if (typeof contents === 'string') {
    return [{ role: 'user', parts: [{ text: contents }] }];
  }
  if (Array.isArray(contents)) return contents;
  return [contents];
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── Extraire le texte de la réponse Gemini ────────────────────────────────────
function extractText(data: any): string {
  return (
    data?.candidates?.[0]?.content?.parts?.[0]?.text ||
    data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') ||
    ''
  );
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
    return '⛔ Quota journalier d\'aide atteint (100/100). Revenez demain.';
  }

  try {
    const systemInstruction = SUPPORT_AGENT_PROMPT(context, user);
    const prompt = history.length > 0
      ? `Historique:\n${history.map(h => `${h.role}: ${h.text}`).join('\n')}\n\nQuestion: ${userQuery}`
      : userQuery;

    const body = buildGenerateBody(prompt, {
      systemInstruction,
      maxOutputTokens: 2000,
      temperature: 0.5,
    });

    const data = await geminiPost(`${TEXT_MODEL}:generateContent`, body);
    storageService.incrementSupportUsage();
    return extractText(data) || "Je n'ai pas de réponse pour le moment.";

  } catch (e: any) {
    console.error('[Gemini] Support error:', e.message);
    return 'Désolé, je rencontre un problème technique. Veuillez réessayer.';
  }
};


// ============================================================================
// 2. CHAT PRINCIPAL — STREAMING DIRECT
// ============================================================================
export async function* sendMessageStream(
  message: string,
  user: UserProfile,
  history: ChatMessage[]
) {
  if (!user.preferences) {
    yield '⚠️ Profil incomplet. Veuillez configurer vos préférences.';
    return;
  }

  if (!(await creditService.checkBalance(user.id, CREDIT_COSTS.LESSON))) {
    yield '⛔ **Crédits épuisés.**\n\nVeuillez recharger votre compte pour continuer.';
    return;
  }

  const key = nextKey();
  if (!key) {
    yield '⚠️ Configuration manquante. Contactez l\'administrateur.';
    return;
  }

  try {
    console.log('[Gemini] Stream direct démarré. Modèle:', TEXT_MODEL);

    // Limiter à 15 messages pour réduire tokens et latence
    const recentHistory = history.slice(-15);
    const contextPrompt = recentHistory
      .filter(msg => msg.text?.trim())
      .map(msg => `${msg.role === 'user' ? 'Élève' : 'Professeur'}: ${msg.text}`)
      .join('\n\n');

    const finalMessage = contextPrompt
      ? `Contexte précédent:\n${contextPrompt}\n\nNouveau message de l'élève: ${message}`
      : message;

    const body = buildGenerateBody(finalMessage, {
      systemInstruction: SYSTEM_PROMPT_TEMPLATE(user, user.preferences!),
      temperature: 0.7,
      maxOutputTokens: 8192,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);

    // Appel direct à Gemini SSE (sans Edge Function !)
    const response = await fetch(
      `${BASE_URL}/${TEXT_MODEL}:streamGenerateContent?alt=sse&key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      // Si rate limit → réessayer avec autre clé (non-streaming)
      if (response.status === 429) {
        console.warn('[Gemini] Rate limit stream, fallback non-stream...');
        const fallbackData = await geminiPost(`${TEXT_MODEL}:generateContent`, body);
        const text = extractText(fallbackData);
        if (text) yield text;
        await creditService.deduct(user.id, CREDIT_COSTS.LESSON);
        return;
      }
      throw new Error(`Gemini Stream ${response.status}: ${errText.slice(0, 100)}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Pas de stream disponible');

    const decoder = new TextDecoder();
    let buffer = '';
    let hasText = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Découper sur \n\n (événements SSE complets)
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const event of events) {
          const dataLine = event.split('\n').find(l => l.startsWith('data: '));
          if (!dataLine) continue;

          const raw = dataLine.slice(6).trim();
          if (raw === '[DONE]') continue;

          try {
            const parsed = JSON.parse(raw);
            const chunk = extractText(parsed);
            if (chunk) {
              yield chunk;
              hasText = true;
            }
          } catch {
            // Chunk JSON incomplet — ignoré
          }
        }
      }
    } finally {
      reader.cancel().catch(() => {});
    }

    if (!hasText) {
      yield '⚠️ Aucune réponse reçue. Veuillez réessayer.';
      return;
    }

    console.log('[Gemini] Stream terminé ✅');
    await creditService.deduct(user.id, CREDIT_COSTS.LESSON);

  } catch (e: any) {
    if (e.name === 'AbortError') {
      yield '⏱️ Le serveur met trop de temps à répondre. Veuillez réessayer.';
    } else {
      console.error('[Gemini] Stream exception:', e.message);
      yield '⚠️ Désolé, le service est temporairement indisponible. Veuillez réessayer.';
    }
  }
}


// ============================================================================
// 3. TEXT-TO-SPEECH (TTS)
// ============================================================================
export const generateSpeech = async (
  text: string,
  voiceName: string = 'Kore',
  cost: number = CREDIT_COSTS.AUDIO_MESSAGE
): Promise<ArrayBuffer | null> => {
  const user = await storageService.getCurrentUser();
  if (!user || !(await creditService.checkBalance(user.id, cost))) return null;

  const key = nextKey();
  if (!key) return null;

  try {
    console.log(`[Gemini TTS] Voix "${voiceName}"...`);

    const body = {
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    };

    const data = await geminiPost(
      `${AUDIO_MODEL}:generateContent`,
      body,
      20_000 // TTS peut être lent — 20s timeout
    );

    const audioBase64 =
      data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data ||
      data?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData)?.inlineData?.data;

    if (!audioBase64) {
      console.warn('[Gemini TTS] Pas de données audio dans la réponse.');
      return null;
    }

    await creditService.deduct(user.id, cost);

    // base64 → ArrayBuffer
    const binary = atob(audioBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    console.log('[Gemini TTS] ✅ Audio généré.');
    return bytes.buffer as ArrayBuffer;

  } catch (e: any) {
    console.warn('[Gemini TTS] Échec:', e.message);
    return null;
  }
};


// ============================================================================
// 4. GÉNÉRATION JSON (exercices, roleplay, vocabulaire)
// ============================================================================
async function generateJSON<T>(
  prompt: string,
  systemInstruction?: string,
  schema?: object
): Promise<T | null> {
  const genConfig: any = {
    maxOutputTokens: 4096,
    temperature: 0.4,
    responseMimeType: 'application/json',
  };

  if (schema) genConfig.responseSchema = schema;

  const body = buildGenerateBody(prompt, {
    ...(systemInstruction ? { systemInstruction } : {}),
    ...genConfig,
  });

  try {
    const data = await geminiPost(`${TEXT_MODEL}:generateContent`, body);
    const raw = extractText(data);
    if (!raw) return null;

    const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(clean) as T;
  } catch (e: any) {
    console.error('[Gemini JSON] Parse error:', e.message);
    return null;
  }
}


// ============================================================================
// 5. EXTRACTION VOCABULAIRE
// ============================================================================
export const extractVocabulary = async (history: ChatMessage[]): Promise<any[]> => {
  const user = await storageService.getCurrentUser();
  if (!user) return [];

  const context = history.slice(-6).map(m => `${m.role}: ${m.text}`).join('\n');
  const prompt = `Analyse la conversation et extrais 3 à 5 mots-clés vocabulaire importants.
Conversation:\n${context}

Réponds UNIQUEMENT en JSON array: [{"word": "...", "translation": "...", "example": "..."}]`;

  const result = await generateJSON<any[]>(prompt);
  if (!result || !Array.isArray(result)) return [];

  return result.map((item: any) => ({
    id: crypto.randomUUID(),
    word: item.word || '',
    translation: item.translation || '',
    example: item.example || '',
    mastered: false,
    addedAt: Date.now(),
  }));
};


// ============================================================================
// 6. EXERCICES
// ============================================================================
export const generateExerciseFromHistory = async (
  history: ChatMessage[],
  user: UserProfile
): Promise<ExerciseItem[]> => {
  if (!(await creditService.checkBalance(user.id, CREDIT_COSTS.EXERCISE))) return [];

  const context = history.slice(-10).map(m => `${m.role}: ${m.text}`).join('\n');
  const prompt = `Génère 3 exercices variés (QCM ou Vrai/Faux) adaptés au niveau ${user.preferences?.level} en ${user.preferences?.targetLanguage}.
Basé sur cette conversation:\n${context}

Réponds UNIQUEMENT en JSON array:
[{
  "type": "multiple_choice" | "true_false",
  "question": "...",
  "options": ["A", "B", "C", "D"],
  "correct": "A",
  "explanation": "..."
}]`;

  const result = await generateJSON<ExerciseItem[]>(prompt);

  if (!result || !Array.isArray(result)) return [];

  await creditService.deduct(user.id, CREDIT_COSTS.EXERCISE);
  return result.map((item: any, i: number) => ({ id: `ex_${i}_${Date.now()}`, ...item }));
};


// ============================================================================
// 7. ROLEPLAY
// ============================================================================
export const generateRoleplayResponse = async (
  history: ChatMessage[],
  scenarioPrompt: string,
  user: UserProfile,
  isClosing: boolean = false,
  _isInitial: boolean = false
): Promise<{ aiReply: string; correction?: string; explanation?: string; score?: number; feedback?: string }> => {
  if (!(await creditService.checkBalance(user.id, CREDIT_COSTS.DIALOGUE_MESSAGE))) {
    return { aiReply: '⚠️ Crédits insuffisants.' };
  }

  const systemInstruction = `Tu es un partenaire de jeu de rôle en ${user.preferences?.targetLanguage} (niveau ${user.preferences?.level}).
Scénario: ${scenarioPrompt}.
Réponds UNIQUEMENT en JSON: {"aiReply": "...", "correction": "..." (si faute), "explanation": "...", "score": 0-100, "feedback": "..."}`;

  const contextPrompt = history.filter(msg => msg.text?.trim()).map(m => `${m.role}: ${m.text}`).join('\n');
  const finalPrompt = isClosing
    ? `${contextPrompt}\n\nFais l'évaluation finale complète.`
    : (contextPrompt || 'Commence le jeu de rôle.');

  const result = await generateJSON<any>(finalPrompt, systemInstruction);

  if (!result) return { aiReply: 'Problème technique. Veuillez réessayer.' };

  await creditService.deduct(user.id, CREDIT_COSTS.DIALOGUE_MESSAGE);
  return result;
};


// ============================================================================
// 8. GÉNÉRATION TEXTE GÉNÉRIQUE
// ============================================================================
export const generateText = async (
  prompt: string,
  model: string = TEXT_MODEL
): Promise<string> => {
  try {
    const body = buildGenerateBody(prompt, { maxOutputTokens: 4096 });
    const data = await geminiPost(`${model}:generateContent`, body);
    return extractText(data);
  } catch (e: any) {
    console.error('[Gemini] generateText error:', e.message);
    return '';
  }
};
