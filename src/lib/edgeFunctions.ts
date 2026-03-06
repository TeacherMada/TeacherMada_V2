/**
 * @file edgeFunctions.ts
 * @description Appel unifié des Supabase Edge Functions.
 * Élimine la duplication de callGeminiFunction dans geminiService.ts et SmartExamService.ts.
 * CORRECTION AUDIT P4 (DRY) — TeacherMada v1.0
 */

import { supabase } from './supabase';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EdgeFunctionResponse<T = any> {
  data: T | null;
  error: string | null;
}

// ─── Appel générique d'une Edge Function ─────────────────────────────────────

/**
 * Appelle une Supabase Edge Function de manière sécurisée.
 * Gère les erreurs réseau, les erreurs HTTP et les erreurs applicatives.
 *
 * @param functionName - Nom de la fonction (ex: 'gemini-api')
 * @param action       - Action à effectuer dans la fonction
 * @param payload      - Paramètres supplémentaires
 * @throws Error avec message lisible en cas d'échec
 */
export const callEdgeFunction = async <T = any>(
  functionName: string,
  action: string,
  payload: Record<string, unknown> = {}
): Promise<T> => {
  const { data, error } = await supabase.functions.invoke(functionName, {
    body: { action, ...payload },
  });

  if (error) {
    console.error(`[EdgeFunction] ${functionName}/${action} — Erreur réseau:`, error);
    throw new Error(error.message ?? 'Erreur de communication avec le serveur');
  }

  // Erreur applicative retournée par la fonction (status 200 mais error field)
  if (data && typeof data === 'object' && 'error' in data && data.error) {
    console.error(`[EdgeFunction] ${functionName}/${action} — Erreur applicative:`, data.error);
    throw new Error(String(data.error));
  }

  return data as T;
};

// ─── Appel spécifique à l'API Gemini ─────────────────────────────────────────

/**
 * Raccourci pour appeler la fonction 'gemini-api'.
 */
export const callGeminiEdge = async <T = any>(
  action: string,
  payload: Record<string, unknown> = {}
): Promise<T> => {
  return callEdgeFunction<T>('gemini-api', action, payload);
};

// ─── Appel avec retry automatique ────────────────────────────────────────────

/**
 * Appelle une Edge Function avec retry exponentiel en cas d'échec temporaire.
 * À utiliser pour les opérations non-critiques (ex: génération d'exercices).
 */
export const callEdgeFunctionWithRetry = async <T = any>(
  functionName: string,
  action: string,
  payload: Record<string, unknown> = {},
  maxRetries = 2
): Promise<T> => {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await callEdgeFunction<T>(functionName, action, payload);
    } catch (e: any) {
      lastError = e;
      // Ne pas retry si c'est une erreur applicative (ex: crédits insuffisants)
      if (e.message?.includes('Insufficient credits') || e.message?.includes('Unauthorized')) {
        throw e;
      }
      if (attempt < maxRetries) {
        const delay = 500 * Math.pow(2, attempt); // 500ms, 1000ms
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  throw lastError ?? new Error('Erreur inconnue');
};

// ─── Health check ─────────────────────────────────────────────────────────────

export const checkGeminiHealth = async (): Promise<{ ok: boolean; keyLength: number }> => {
  try {
    const data = await callEdgeFunction<{ status: string; hasKey: boolean; keyLength: number }>(
      'gemini-api', 'health'
    );
    return { ok: data?.status === 'ok' && data?.hasKey, keyLength: data?.keyLength ?? 0 };
  } catch {
    return { ok: false, keyLength: 0 };
  }
};
