/**
 * @file localStorageManager.ts
 * @description Gestionnaire LRU (Least Recently Used) du localStorage.
 * Évite les crashs silencieux par saturation du quota 5MB.
 * CORRECTION CRITIQUE P4 — TeacherMada Audit v1.0
 */

const MAX_SIZE_MB = 3.5; // Seuil conservateur (limite réelle = 5MB)
const SESSION_PREFIX = 'tm_v3_session_';
const VOCAB_PREFIX = 'tm_vocab_';
const EXAM_PREFIX = 'tm_exam_';

class LocalStorageManager {

  // ─── Calcul de l'utilisation actuelle ───────────────────────────────────────
  getUsageMB(): number {
    let total = 0;
    try {
      for (const key of Object.keys(localStorage)) {
        total += ((localStorage.getItem(key) ?? '').length + key.length) * 2; // UTF-16: 2 bytes/char
      }
    } catch { /* ignoré */ }
    return total / (1024 * 1024);
  }

  isNearQuota(): boolean {
    return this.getUsageMB() >= MAX_SIZE_MB;
  }

  // ─── Eviction LRU : supprime les sessions les plus anciennes ────────────────
  private evictOldSessions(count = 3): number {
    const sessions = Object.keys(localStorage)
      .filter(k => k.startsWith(SESSION_PREFIX))
      .map(k => {
        try {
          const data = JSON.parse(localStorage.getItem(k) ?? '{}');
          return { key: k, updatedAt: data.updatedAt ?? 0 };
        } catch {
          return { key: k, updatedAt: 0 };
        }
      })
      .sort((a, b) => a.updatedAt - b.updatedAt); // Plus ancien en premier

    let removed = 0;
    for (const s of sessions.slice(0, count)) {
      localStorage.removeItem(s.key);
      removed++;
    }
    return removed;
  }

  // ─── Eviction des vocabulaires anciens ──────────────────────────────────────
  private evictOldVocab(): number {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(VOCAB_PREFIX));
    let removed = 0;
    // Garder seulement les 5 langues les plus récentes (vocab peut être volumineux)
    if (keys.length > 5) {
      const sorted = keys.map(k => {
        try {
          const data = JSON.parse(localStorage.getItem(k) ?? '{}');
          const words = Array.isArray(data) ? data : [];
          const lastDate = words.reduce((max: number, w: any) => Math.max(max, w.addedAt ?? 0), 0);
          return { key: k, lastDate };
        } catch {
          return { key: k, lastDate: 0 };
        }
      }).sort((a, b) => a.lastDate - b.lastDate);

      for (const item of sorted.slice(0, keys.length - 5)) {
        localStorage.removeItem(item.key);
        removed++;
      }
    }
    return removed;
  }

  // ─── Eviction des anciens résultats d'examens ────────────────────────────────
  private evictOldExams(): number {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(EXAM_PREFIX));
    let removed = 0;
    if (keys.length > 10) {
      const sorted = keys.map(k => {
        try {
          const data = JSON.parse(localStorage.getItem(k) ?? '{}');
          return { key: k, date: data.date ?? 0 };
        } catch {
          return { key: k, date: 0 };
        }
      }).sort((a, b) => a.date - b.date);

      for (const item of sorted.slice(0, keys.length - 10)) {
        localStorage.removeItem(item.key);
        removed++;
      }
    }
    return removed;
  }

  // ─── Eviction globale d'urgence ──────────────────────────────────────────────
  private runEviction(): void {
    let freed = 0;
    freed += this.evictOldSessions(3);
    if (this.isNearQuota()) freed += this.evictOldVocab();
    if (this.isNearQuota()) freed += this.evictOldExams();
    if (freed > 0) {
      console.info(`[LSManager] Éviction LRU: ${freed} entrées supprimées. Usage: ${this.getUsageMB().toFixed(2)}MB`);
    }
  }

  // ─── Écriture sécurisée ──────────────────────────────────────────────────────
  safeSet(key: string, value: string): boolean {
    try {
      // Éviction préventive si proche du quota
      if (this.isNearQuota()) {
        this.runEviction();
      }
      localStorage.setItem(key, value);
      return true;
    } catch (e: any) {
      // Quota exceeded : tentative d'éviction d'urgence
      if (e?.name === 'QuotaExceededError' || e?.code === 22) {
        console.warn('[LSManager] Quota exceeded, tentative d\'éviction d\'urgence...');
        this.evictOldSessions(5);
        this.evictOldVocab();
        this.evictOldExams();
        try {
          localStorage.setItem(key, value);
          return true;
        } catch {
          console.error('[LSManager] Impossible d\'écrire même après éviction:', key);
          return false;
        }
      }
      console.error('[LSManager] Erreur inattendue:', e);
      return false;
    }
  }

  // ─── Lecture sécurisée ───────────────────────────────────────────────────────
  safeGet(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  // ─── Suppression sécurisée ───────────────────────────────────────────────────
  safeRemove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch { /* ignoré */ }
  }

  // ─── Parse JSON sécurisé ─────────────────────────────────────────────────────
  safeGetJson<T>(key: string, fallback: T): T {
    try {
      const raw = this.safeGet(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  }

  // ─── Stringify + set sécurisé ────────────────────────────────────────────────
  safeSetJson(key: string, value: unknown): boolean {
    try {
      return this.safeSet(key, JSON.stringify(value));
    } catch {
      return false;
    }
  }

  // ─── Debug: résumé de l'utilisation ─────────────────────────────────────────
  getDebugInfo(): { usageMB: number; itemCount: number; sessions: number; nearQuota: boolean } {
    return {
      usageMB: parseFloat(this.getUsageMB().toFixed(3)),
      itemCount: Object.keys(localStorage).length,
      sessions: Object.keys(localStorage).filter(k => k.startsWith(SESSION_PREFIX)).length,
      nearQuota: this.isNearQuota(),
    };
  }
}

export const lsManager = new LocalStorageManager();
