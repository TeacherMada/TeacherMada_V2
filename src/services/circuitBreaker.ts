/**
 * @file circuitBreaker.ts
 * @description Circuit Breaker Pattern pour protéger l'app contre les pannes API
 * 
 * PRINCIPE :
 * - CLOSED : Tout fonctionne normalement
 * - OPEN : Trop d'échecs, bloque les requêtes
 * - HALF_OPEN : Test si le service est revenu
 * 
 * USAGE :
 * const breaker = new CircuitBreaker();
 * const result = await breaker.execute(() => callAPI());
 */

import { toast } from '../components/Toaster';
import { errorService } from './errorService';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerOptions {
  failureThreshold?: number; // Nb d'échecs avant ouverture
  successThreshold?: number; // Nb de succès en HALF_OPEN pour fermer
  timeout?: number; // Temps avant retry (ms)
  name?: string; // Nom du circuit pour logs
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private successes = 0;
  private lastFailTime = 0;
  private nextRetryTime = 0;

  private readonly failureThreshold: number;
  private readonly successThreshold: number;
  private readonly timeout: number;
  private readonly name: string;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold || 3;
    this.successThreshold = options.successThreshold || 2;
    this.timeout = options.timeout || 30000; // 30s par défaut
    this.name = options.name || 'Circuit';
  }

  /**
   * Exécuter une fonction protégée par le circuit breaker
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Si circuit ouvert, vérifier si on peut réessayer
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextRetryTime) {
        const waitSeconds = Math.ceil((this.nextRetryTime - Date.now()) / 1000);
        throw new Error(
          `[${this.name}] Service temporairement indisponible. Réessayez dans ${waitSeconds}s.`
        );
      }
      // Passer en HALF_OPEN pour tester
      this.state = 'HALF_OPEN';
      this.successes = 0;
      console.log(`[${this.name}] Circuit HALF_OPEN - Test de récupération...`);
    }

    try {
      const result = await this.executeWithTimeout(fn);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  /**
   * Réinitialiser le circuit manuellement
   */
  reset() {
    this.state = 'CLOSED';
    this.failures = 0;
    this.successes = 0;
    this.lastFailTime = 0;
    this.nextRetryTime = 0;
    console.log(`[${this.name}] Circuit réinitialisé`);
  }

  /**
   * Obtenir l'état actuel
   */
  getState(): {
    state: CircuitState;
    failures: number;
    successes: number;
    nextRetryIn?: number;
  } {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      nextRetryIn:
        this.state === 'OPEN'
          ? Math.max(0, this.nextRetryTime - Date.now())
          : undefined,
    };
  }

  // ────────────────────────────────────────────────────────────
  // MÉTHODES PRIVÉES
  // ────────────────────────────────────────────────────────────

  private async executeWithTimeout<T>(fn: () => Promise<T>): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<T>((_, reject) =>
        setTimeout(
          () => reject(new Error('Timeout')),
          this.timeout
        )
      ),
    ]);
  }

  private onSuccess() {
    this.failures = 0;

    if (this.state === 'HALF_OPEN') {
      this.successes++;
      console.log(
        `[${this.name}] Succès en HALF_OPEN (${this.successes}/${this.successThreshold})`
      );

      // Fermer le circuit si assez de succès
      if (this.successes >= this.successThreshold) {
        this.state = 'CLOSED';
        this.successes = 0;
        console.log(`[${this.name}] ✅ Circuit FERMÉ - Service rétabli`);
        toast.success(`${this.name} : Service rétabli !`);
      }
    } else if (this.state === 'CLOSED') {
      // Tout va bien
    }
  }

  private onFailure(error: unknown) {
    this.failures++;
    this.lastFailTime = Date.now();

    errorService.logError(error as Error, {
      context: `CircuitBreaker:${this.name}`,
      severity: 'medium',
      metadata: {
        failures: this.failures,
        state: this.state,
      },
    });

    if (this.state === 'HALF_OPEN') {
      // Échec en HALF_OPEN = retour à OPEN
      this.openCircuit();
    } else if (this.failures >= this.failureThreshold) {
      // Trop d'échecs en CLOSED = passer à OPEN
      this.openCircuit();
    }
  }

  private openCircuit() {
    this.state = 'OPEN';
    this.nextRetryTime = Date.now() + this.timeout;

    const waitSeconds = Math.ceil(this.timeout / 1000);
    console.warn(
      `[${this.name}] ⚠️ Circuit OUVERT - Service désactivé pour ${waitSeconds}s`
    );

    toast.error(
      `${this.name} temporairement indisponible. Réessayez dans ${waitSeconds}s.`
    );
  }
}

// ────────────────────────────────────────────────────────────
// CIRCUIT BREAKERS PRÉ-CONFIGURÉS
// ────────────────────────────────────────────────────────────

/**
 * Circuit breaker pour l'API Gemini
 * Plus permissif car l'IA peut être lente
 */
export const geminiCircuitBreaker = new CircuitBreaker({
  failureThreshold: 5, // 5 échecs avant ouverture
  successThreshold: 3, // 3 succès pour fermer
  timeout: 60000, // 1 minute
  name: 'Gemini AI',
});

/**
 * Circuit breaker pour Supabase
 * Plus strict car critique
 */
export const supabaseCircuitBreaker = new CircuitBreaker({
  failureThreshold: 3,
  successThreshold: 2,
  timeout: 30000, // 30s
  name: 'Supabase',
});

/**
 * Circuit breaker pour le Text-to-Speech
 */
export const ttsCircuitBreaker = new CircuitBreaker({
  failureThreshold: 4,
  successThreshold: 2,
  timeout: 45000, // 45s
  name: 'TTS',
});
