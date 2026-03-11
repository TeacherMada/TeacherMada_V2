/**
 * @file errorService.ts
 * @description Service centralisé de gestion d'erreurs
 * VERSION CORRIGÉE - Compatible avec Toaster existant
 */

import { toast } from '../components/Toaster';

interface ErrorContext {
  context?: string;
  userId?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  metadata?: Record<string, any>;
}

class ErrorService {
  private errorCount = new Map<string, number>();
  private errorHistory: Array<{ error: Error; timestamp: number; context: ErrorContext }> = [];
  private readonly MAX_ERRORS_PER_MINUTE = 10;
  private readonly MAX_HISTORY_SIZE = 50;

  logError(error: Error | unknown, context: ErrorContext = {}) {
    const err = this.normalizeError(error);
    const key = `${err.name}_${context.context || 'unknown'}`;
    const count = this.errorCount.get(key) || 0;

    if (count >= this.MAX_ERRORS_PER_MINUTE) {
      console.warn('[ErrorService] Rate limit atteint pour:', key);
      return;
    }

    this.errorCount.set(key, count + 1);

    this.errorHistory.push({
      error: err,
      timestamp: Date.now(),
      context,
    });

    if (this.errorHistory.length > this.MAX_HISTORY_SIZE) {
      this.errorHistory.shift();
    }

    console.error(
      `[ErrorService] ${context.severity || 'medium'}`,
      {
        message: err.message,
        stack: err.stack,
        ...context,
      }
    );

    if (import.meta.env.PROD && window.Sentry) {
      window.Sentry.captureException(err, {
        level: this.mapSeverity(context.severity),
        extra: context.metadata,
        tags: {
          context: context.context,
          userId: context.userId,
        },
      });
    }

    this.showUserFeedback(err, context);
  }

  logApiError(endpoint: string, error: Error | unknown, statusCode?: number) {
    this.logError(error, {
      context: `API:${endpoint}`,
      severity: statusCode && statusCode >= 500 ? 'high' : 'medium',
      metadata: { endpoint, statusCode },
    });
  }

  logSupabaseError(operation: string, error: any) {
    this.logError(error, {
      context: `Supabase:${operation}`,
      severity: 'high',
      metadata: {
        code: error?.code,
        details: error?.details,
        hint: error?.hint,
      },
    });
  }

  clearErrorCounts() {
    this.errorCount.clear();
  }

  getErrorStats() {
    const last5Minutes = Date.now() - 5 * 60 * 1000;
    const recentErrors = this.errorHistory.filter(
      (e) => e.timestamp > last5Minutes
    );

    return {
      total: this.errorHistory.length,
      recent: recentErrors.length,
      byContext: this.groupByContext(recentErrors),
      critical: recentErrors.filter((e) => e.context.severity === 'critical').length,
    };
  }

  private normalizeError(error: unknown): Error {
    if (error instanceof Error) return error;
    if (typeof error === 'string') return new Error(error);
    return new Error(JSON.stringify(error));
  }

  private mapSeverity(severity?: string): 'fatal' | 'error' | 'warning' | 'info' {
    switch (severity) {
      case 'critical': return 'fatal';
      case 'high': return 'error';
      case 'medium': return 'warning';
      default: return 'info';
    }
  }

  private showUserFeedback(error: Error, context: ErrorContext) {
    if (context.severity === 'low') return;

    const messages: Record<string, string> = {
      'Supabase:login': 'Erreur de connexion. Vérifiez vos identifiants.',
      'Supabase:update': 'Impossible de sauvegarder. Réessayez.',
      'API:gemini': "L'IA est temporairement indisponible.",
      'Network': 'Connexion internet perdue.',
    };

    const message = messages[context.context || ''] || 'Une erreur est survenue.';

    // ✅ CORRECTION : Utiliser seulement toast.error et toast.info (pas toast.warning)
    if (context.severity === 'critical' || context.severity === 'high') {
      toast.error(`❌ ${message}`);
    } else {
      toast.info(`ℹ️ ${message}`);
    }
  }

  private groupByContext(errors: Array<{ error: Error; timestamp: number; context: ErrorContext }>) {
    const grouped = new Map<string, number>();
    for (const { context } of errors) {
      const key = context.context || 'unknown';
      grouped.set(key, (grouped.get(key) || 0) + 1);
    }
    return Object.fromEntries(grouped);
  }
}

export const errorService = new ErrorService();

// Export type for global usage
export type { ErrorContext };

if (typeof window !== 'undefined') {
  setInterval(() => errorService.clearErrorCounts(), 60000);
  (window as any).errorService = errorService;
}

declare global {
  interface Window {
    Sentry?: any;
  }
}
