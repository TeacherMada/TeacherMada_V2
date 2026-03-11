/**
 * @file errorService.ts
 * @description Service centralisé de gestion d'erreurs pour TeacherMada V2
 * 
 * FONCTIONNALITÉS :
 * - Logging intelligent avec rate limiting
 * - Intégration Sentry (production)
 * - Feedback utilisateur via toast
 * - Tracking des erreurs récurrentes
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

  /**
   * Logger une erreur avec contexte
   */
  logError(error: Error | unknown, context: ErrorContext = {}) {
    const err = this.normalizeError(error);
    const key = `${err.name}_${context.context || 'unknown'}`;
    const count = this.errorCount.get(key) || 0;

    // Rate limiting pour éviter spam de logs
    if (count >= this.MAX_ERRORS_PER_MINUTE) {
      console.warn('[ErrorService] Rate limit atteint pour:', key);
      return;
    }

    this.errorCount.set(key, count + 1);

    // Historique
    this.errorHistory.push({
      error: err,
      timestamp: Date.now(),
      context,
    });

    // Garder historique limité
    if (this.errorHistory.length > this.MAX_HISTORY_SIZE) {
      this.errorHistory.shift();
    }

    // Log console
    console.error(
      `[ErrorService] ${context.severity || 'medium'}`,
      {
        message: err.message,
        stack: err.stack,
        ...context,
      }
    );

    // Envoyer à Sentry en production
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

    // Feedback utilisateur
    this.showUserFeedback(err, context);
  }

  /**
   * Logger une erreur API spécifique
   */
  logApiError(endpoint: string, error: Error | unknown, statusCode?: number) {
    this.logError(error, {
      context: `API:${endpoint}`,
      severity: statusCode && statusCode >= 500 ? 'high' : 'medium',
      metadata: { endpoint, statusCode },
    });
  }

  /**
   * Logger une erreur Supabase
   */
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

  /**
   * Nettoyer les compteurs d'erreurs
   */
  clearErrorCounts() {
    this.errorCount.clear();
  }

  /**
   * Obtenir les statistiques d'erreurs
   */
  getErrorStats() {
    const last5Minutes = Date.now() - 5 * 60 * 1000;
    const recentErrors = this.errorHistory.filter(
      (e) => e.timestamp > last5Minutes
    );

    return {
      total: this.errorHistory.length,
      recent: recentErrors.length,
      byContext: this.groupByContext(recentErrors),
      critical: recentErrors.filter((e) => e.context.severity === 'critical')
        .length,
    };
  }

  /**
   * Vérifier si l'app est dans un état d'erreur critique
   */
  isInCriticalState(): boolean {
    const stats = this.getErrorStats();
    return stats.critical > 3 || stats.recent > 20;
  }

  // ────────────────────────────────────────────────────────────
  // MÉTHODES PRIVÉES
  // ────────────────────────────────────────────────────────────

  private normalizeError(error: unknown): Error {
    if (error instanceof Error) {
      return error;
    }
    if (typeof error === 'string') {
      return new Error(error);
    }
    return new Error(JSON.stringify(error));
  }

  private mapSeverity(severity?: string): 'fatal' | 'error' | 'warning' | 'info' {
    switch (severity) {
      case 'critical':
        return 'fatal';
      case 'high':
        return 'error';
      case 'medium':
        return 'warning';
      default:
        return 'info';
    }
  }

  private showUserFeedback(error: Error, context: ErrorContext) {
    // Pas de toast pour erreurs low severity
    if (context.severity === 'low') return;

    // Messages personnalisés selon le contexte
    const messages: Record<string, string> = {
      'Supabase:login': 'Erreur de connexion. Vérifiez vos identifiants.',
      'Supabase:update': 'Impossible de sauvegarder. Réessayez dans un instant.',
      'API:gemini': "L'IA est temporairement indisponible. Veuillez patienter.",
      'Network': 'Connexion internet perdue. Mode hors ligne activé.',
    };

    const message =
      messages[context.context || ''] ||
      'Une erreur est survenue. Veuillez réessayer.';

    if (context.severity === 'critical') {
      toast.error(`❌ ${message}`);
    } else {
      toast.warning(`⚠️ ${message}`);
    }
  }

  private groupByContext(
    errors: Array<{ error: Error; timestamp: number; context: ErrorContext }>
  ) {
    const grouped = new Map<string, number>();
    for (const { context } of errors) {
      const key = context.context || 'unknown';
      grouped.set(key, (grouped.get(key) || 0) + 1);
    }
    return Object.fromEntries(grouped);
  }
}

// Singleton
export const errorService = new ErrorService();

// Nettoyer les compteurs toutes les minutes
if (typeof window !== 'undefined') {
  setInterval(() => {
    errorService.clearErrorCounts();
  }, 60000);
}

// Types pour TypeScript
declare global {
  interface Window {
    Sentry?: any;
  }
}
