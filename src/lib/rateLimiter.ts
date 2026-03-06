/**
 * @file rateLimiter.ts
 * @description Rate limiter côté client pour protéger les Edge Functions.
 * Empêche les appels en boucle ou le spam involontaire.
 * CORRECTION AUDIT — TeacherMada v1.0
 */

interface RateLimitConfig {
  maxCalls: number;   // Nombre max d'appels dans la fenêtre
  windowMs: number;   // Durée de la fenêtre en ms
  cooldownMs?: number; // Délai de refroidissement après dépassement (optionnel)
}

// Configurations par défaut pour chaque type d'opération
export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  chat:          { maxCalls: 5,   windowMs: 10_000,  cooldownMs: 3_000  }, // 5 msgs / 10s
  tts:           { maxCalls: 10,  windowMs: 30_000                       }, // 10 TTS / 30s
  exercise:      { maxCalls: 3,   windowMs: 30_000                       }, // 3 exos / 30s
  roleplay:      { maxCalls: 8,   windowMs: 20_000                       }, // 8 msgs / 20s
  exam:          { maxCalls: 2,   windowMs: 60_000                       }, // 2 examens / 1min
  support:       { maxCalls: 10,  windowMs: 60_000                       }, // 10 msgs support / 1min
  creditDeduct:  { maxCalls: 20,  windowMs: 60_000                       }, // 20 déductions / 1min (anti-spam)
};

class RateLimiter {
  private callTimestamps = new Map<string, number[]>();
  private cooldowns = new Map<string, number>();

  /**
   * Vérifie si un appel est autorisé.
   * @returns true si l'appel peut être effectué, false si limité.
   */
  canCall(key: string, configOverride?: RateLimitConfig): boolean {
    const config = configOverride ?? RATE_LIMITS[key];
    if (!config) return true; // Pas de config = pas de limite

    const now = Date.now();

    // Vérifier le cooldown actif
    const cooldownUntil = this.cooldowns.get(key) ?? 0;
    if (now < cooldownUntil) return false;

    // Nettoyer les timestamps hors fenêtre
    const timestamps = (this.callTimestamps.get(key) ?? [])
      .filter(t => now - t < config.windowMs);

    if (timestamps.length >= config.maxCalls) {
      // Activer le cooldown si configuré
      if (config.cooldownMs) {
        this.cooldowns.set(key, now + config.cooldownMs);
      }
      return false;
    }

    // Enregistrer l'appel
    timestamps.push(now);
    this.callTimestamps.set(key, timestamps);
    return true;
  }

  /**
   * Retourne le temps restant avant le prochain appel autorisé (en ms).
   * 0 = appel autorisé immédiatement.
   */
  getWaitTime(key: string, configOverride?: RateLimitConfig): number {
    const config = configOverride ?? RATE_LIMITS[key];
    if (!config) return 0;

    const now = Date.now();
    const cooldownUntil = this.cooldowns.get(key) ?? 0;
    if (now < cooldownUntil) return cooldownUntil - now;

    const timestamps = (this.callTimestamps.get(key) ?? [])
      .filter(t => now - t < config.windowMs);

    if (timestamps.length < config.maxCalls) return 0;

    // Temps avant que le plus ancien timestamp sorte de la fenêtre
    const oldest = Math.min(...timestamps);
    return Math.max(0, (oldest + config.windowMs) - now);
  }

  /**
   * Réinitialise le compteur pour une clé (ex: après changement d'utilisateur).
   */
  reset(key?: string): void {
    if (key) {
      this.callTimestamps.delete(key);
      this.cooldowns.delete(key);
    } else {
      this.callTimestamps.clear();
      this.cooldowns.clear();
    }
  }

  /**
   * Retourne un message d'erreur lisible pour l'utilisateur.
   */
  getErrorMessage(key: string): string {
    const waitMs = this.getWaitTime(key);
    if (waitMs <= 0) return '';
    const waitSec = Math.ceil(waitMs / 1000);
    return `⏳ Trop de requêtes. Attendez ${waitSec} seconde${waitSec > 1 ? 's' : ''}.`;
  }
}

export const rateLimiter = new RateLimiter();
