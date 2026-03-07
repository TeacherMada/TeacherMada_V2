/**
 * ============================================================================
 * TeacherMada — geminiService.ts v4.1
 * ✅ Fix: correct → correctAnswer (ExerciseItem type)
 * ✅ Fix: messages with undefined text filtrés avant envoi
 * ✅ Fix: fallback modèles automatique
 * ============================================================================
 */

import { UserProfile, ChatMessage, ExerciseItem } from "../types";
import { SYSTEM_PROMPT_TEMPLATE, SUPPORT_AGENT_PROMPT } from "../constants";
import { storageService } from "./storageService";
import { creditService, CREDIT_COSTS } from "./creditService";

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

// ── Rotation clés ─────────────────────────────────────────────────────────────
let _keyIdx = 0;
function nextKey(): string {
  if (RAW_KEYS.length === 0) return '';
  const key = RAW_KEYS[_keyIdx % RAW_KEYS.length];
  _keyIdx++;
  return key;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── Appel Gemini avec retry + fallback modèles ────────────────────────────────
async function callGemini(
  modelName: string,
  body: object,
  timeoutMs = 30_000,
  maxRetries = 2
): Promise<any> {
  const modelsToTry = modelName === TEXT_MODEL
    ? TEXT_MODELS
    : [modelName, ...TEXT_MODELS];

  let lastErr = 'Erreur inconnue';

  for (const model of modelsToTry) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const key = nextKey();
      if (!key) throw new Error('GEMINI_API_KEY manquant dans Render.');

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

        if (res.status === 429) {
          lastErr = `Rate limit (clé ${attempt + 1}, modèle ${model})`;
          console.warn(`[Gemini] ${lastErr}`);
          await sleep(500 * (attempt + 1));
          continue;
        }

        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          lastErr = `${model} HTTP ${res.status}: ${txt.slice(0, 100)}`;
          console.warn(`[Gemini] ${lastErr}`);
          if (res.status === 400) break;
          await sleep(500 * (attempt + 1));
          continue;
        }

        const data = await res.json();
        console.log(`[Gemini] ✅ Réponse (modèle: ${model})`);
        return data;

      } catch (e: any) {
        clearTimeout(timer);
        lastErr = e.name === 'AbortError' ? `Timeout ${timeoutMs / 1000}s` : e.message;
        console.warn(`[Gemini] Tentative ${attempt + 1} échouée:`, lastErr);
        if (attempt < maxRetries) await sleep(500 * (attempt + 1));
      }
    }
  }

  throw new Error(`[Gemini] Toutes les tentatives échouées. Dernière erreur: ${lastErr}`);
}

// ── Construire le body ────────────────────────────────────────────────────────
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

// ── Extraire le texte ─────────────────────────────────────────────────────────
function extractText(data: any): string {
  if (!data?.candidates?.length) return '';
  const parts = data.candidates[0]?.content?.parts || [];
  return parts.map((p: any) => p.text || '').join('');
}

// ── Extraire JSON depuis la réponse ──────────────────────────────────────────
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

// ── Filtrer les messages valides ──────────────────────────────────────────────
function validMessages(history: ChatMessage[]): ChatMessage[] {
  return history.filter(m => m && typeof m.text === 'string' && m.text.trim().length > 0);
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

  const safeHistory = history.filter(h => h && typeof h.text === 'string' && h.text.trim());
  const prompt = safeHistory.length > 0
    ? `Historique:\n${safeHistory.map(h => `${h.role}: ${h.text}`).join('\n')}\n\nQuestion: ${userQuery}`
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
    console.error('[Gemini] Support error:', e.message);
    return "Désolé, je rencontre un problème technique. Veuillez réessayer.";
  }
};


// ============================================================================
// 2. CHAT PRINCIPAL
//    sendMessageStream conservé pour compatibilité (pas de vrai streaming)
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

  if (!(await creditService.checkBalance(user.id, CREDIT_COSTS.LESSON))) {
    yield "⛔ **Crédits épuisés.**\n\nVeuillez recharger votre compte pour continuer.";
    return;
  }

  try {
    console.log("[Gemini] Appel démarré. Modèle:", TEXT_MODEL);

    // ✅ Filtrer les messages avec texte vide ou undefined
    const recentValid = validMessages(history).slice(-15);
    const contextPrompt = recentValid
      .map(m => `${m.role === 'user' ? 'Élève' : 'Professeur'}: ${m.text}`)
      .join('\n\n');

    const finalMessage = contextPrompt
      ? `Contexte précédent:\n${contextPrompt}\n\nNouveau message de l'élève: ${message}`
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

    // Envoi par blocs pour un effet de frappe naturel
    const chunkSize = 200;
    for (let i = 0; i < text.length; i += chunkSize) {
      yield text.slice(i, i + chunkSize);
      if (i + chunkSize < text.length) await sleep(20);
    }

    console.log("[Gemini] ✅ Réponse envoyée.");
    await creditService.deduct(user.id, CREDIT_COSTS.LESSON);

  } catch (e: any) {
    console.error("[Gemini] Erreur chat:", e.message);
    yield "⚠️ Désolé, le service est temporairement indisponible. Veuillez réessayer.";
  }
}


// ============================================================================
// 3. TEXT-TO-SPEECH
// ============================================================================
export const generateSpeech = async (
  text: string,
  voiceName: string = 'Kore',
  cost: number = CREDIT_COSTS.AUDIO_MESSAGE
): Promise<ArrayBuffer | null> => {
  const user = await storageService.getCurrentUser();
  if (!user || !(await creditService.checkBalance(user.id, cost))) return null;

  try {
    const data = await callGemini(
      AUDIO_MODEL,
      {
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName } },
          },
        },
      },
      20_000
    );

    const audioBase64 =
      data?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData)?.inlineData?.data;

    if (!audioBase64) return null;

    await creditService.deduct(user.id, cost);

    const binary = atob(audioBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer as ArrayBuffer;

  } catch (e: any) {
    console.warn('[Gemini TTS] Échec:', e.message);
    return null;
  }
};


// ============================================================================
// 4. VOCABULAIRE
// ============================================================================
export const extractVocabulary = async (history: ChatMessage[]): Promise<any[]> => {
  const user = await storageService.getCurrentUser();
  if (!user) return [];

  const context = validMessages(history).slice(-6)
    .map(m => `${m.role}: ${m.text}`).join('\n');

  if (!context) return [];

  const prompt = `Extrais 3 à 5 mots-clés vocabulaire de cette conversation.
Réponds UNIQUEMENT en JSON array: [{"word":"...","translation":"...","example":"..."}]

Conversation:\n${context}`;

  try {
    const data = await callGemini(TEXT_MODEL, buildBody(prompt, {
      maxOutputTokens: 1024,
      temperature: 0.3,
      responseMimeType: 'application/json',
    }));

    const result = extractJSON<any[]>(data);
    if (!Array.isArray(result)) return [];

    return result.map(item => ({
      id: crypto.randomUUID(),
      word: String(item.word || ''),
      translation: String(item.translation || ''),
      example: String(item.example || ''),
      mastered: false,
      addedAt: Date.now(),
    }));
  } catch { return []; }
};


// ============================================================================
// 5. EXERCICES
// ✅ FIX PRINCIPAL : "correct" → "correctAnswer" pour correspondre à ExerciseItem
// ============================================================================
export const generateExerciseFromHistory = async (
  history: ChatMessage[],
  user: UserProfile
): Promise<ExerciseItem[]> => {
  if (!(await creditService.checkBalance(user.id, CREDIT_COSTS.EXERCISE))) return [];

  // ✅ Filtrer les messages valides avant envoi
  const validHistory = validMessages(history);
  if (validHistory.length < 2) {
    console.warn('[Gemini] Historique insuffisant pour générer des exercices');
    return [];
  }

  const context = validHistory.slice(-10)
    .map(m => `${m.role}: ${m.text}`).join('\n');

  // ✅ Prompt JSON strict avec "correctAnswer" (nom attendu par ExerciseItem)
  const prompt = `Tu es un professeur de langues. Génère exactement 3 exercices variés pour un apprenant de niveau ${user.preferences?.level || 'B1'} en ${user.preferences?.targetLanguage || 'Anglais'}.

Basé sur cette conversation pédagogique:
${context}

RÈGLES STRICTES:
- Type 1: "multiple_choice" avec 4 options (A, B, C, D)
- Type 2: "true_false" avec options ["Vrai", "Faux"]  
- Utilise le vocabulaire ou la grammaire de la conversation
- Les questions doivent être en ${user.preferences?.explanationLanguage || 'Français'}

Réponds UNIQUEMENT en JSON array valide (pas de texte avant ou après):
[
  {
    "type": "multiple_choice",
    "question": "Question ici",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correctAnswer": "Option A",
    "explanation": "Explication courte"
  },
  {
    "type": "true_false",
    "question": "Affirmation à évaluer",
    "options": ["Vrai", "Faux"],
    "correctAnswer": "Vrai",
    "explanation": "Explication courte"
  }
]`;

  try {
    const data = await callGemini(TEXT_MODEL, buildBody(prompt, {
      maxOutputTokens: 2048,
      temperature: 0.4,
      responseMimeType: 'application/json',
    }));

    const raw = extractJSON<any[]>(data);
    if (!Array.isArray(raw) || raw.length === 0) {
      console.warn('[Gemini] Réponse exercices invalide:', raw);
      return [];
    }

    // ✅ Validation et nettoyage de chaque exercice
    const exercises: ExerciseItem[] = raw
      .filter(item =>
        item &&
        typeof item.question === 'string' && item.question.trim() &&
        typeof item.correctAnswer === 'string' && item.correctAnswer.trim() &&
        Array.isArray(item.options) && item.options.length >= 2
      )
      .map((item: any, i: number) => ({
        id: `ex_${i}_${Date.now()}`,
        type: (item.type === 'true_false' ? 'true_false' : 'multiple_choice') as ExerciseItem['type'],
        question: String(item.question).trim(),
        options: item.options.map((o: any) => String(o).trim()),
        correctAnswer: String(item.correctAnswer).trim(),
        explanation: String(item.explanation || '').trim(),
      }));

    if (exercises.length === 0) {
      console.warn('[Gemini] Aucun exercice valide après validation');
      return [];
    }

    await creditService.deduct(user.id, CREDIT_COSTS.EXERCISE);
    console.log(`[Gemini] ✅ ${exercises.length} exercice(s) générés.`);
    return exercises;

  } catch (e: any) {
    console.error('[Gemini] generateExercise error:', e.message);
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

  const sys = `Tu es partenaire de jeu de rôle en ${user.preferences?.targetLanguage} (niveau ${user.preferences?.level}).
Scénario: ${scenarioPrompt}.
Réponds en JSON: {"aiReply":"...","correction":"...","explanation":"...","score":0-100,"feedback":"..."}`;

  const ctx = validMessages(history).map(m => `${m.role}: ${m.text}`).join('\n');
  const prompt = isClosing ? `${ctx}\n\nFais l'évaluation finale.` : (ctx || "Commence.");

  try {
    const data = await callGemini(TEXT_MODEL, buildBody(prompt, {
      systemInstruction: sys,
      temperature: 0.6,
      responseMimeType: 'application/json',
    }));

    const result = extractJSON<any>(data);
    if (!result) return { aiReply: "Continuons la conversation." };

    await creditService.deduct(user.id, CREDIT_COSTS.DIALOGUE_MESSAGE);
    return result;
  } catch {
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
    console.error('[Gemini] generateText error:', e.message);
    return '';
  }
};
