/**
 * @file cacheService.ts
 * @description Cache intelligent multi-niveau pour TeacherMada V2
 * 
 * STRATÉGIES :
 * - Memory Cache (ultra rapide, volatile)
 * - LocalStorage Cache (persistant, limité à 5MB)
 * - LRU (Least Recently Used) pour éviction
 * 
 * USAGE :
 * cacheService.set('user_123', userData, { ttl: 300000 }); // 5min
 * const data = cacheService.get('user_123');
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  hits: number;
  ttl: number; // Time to live en ms
}

interface CacheOptions {
  ttl?: number; // Durée de vie en ms (défaut: 5min)
  persist?: boolean; // Sauvegarder en LocalStorage
  priority?: 'low' | 'normal' | 'high'; // Pour éviction
}

class CacheService {
  private memoryCache = new Map<string, CacheEntry<any>>();
  private readonly DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_MEMORY_SIZE = 100; // Nb max d'entrées en mémoire
  private readonly STORAGE_PREFIX = 'tm_cache_';

  /**
   * Ajouter/Mettre à jour une entrée dans le cache
   */
  set<T>(key: string, data: T, options: CacheOptions = {}): void {
    const ttl = options.ttl || this.DEFAULT_TTL;
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      hits: 0,
      ttl,
    };

    // Memory cache
    this.evictIfNeeded();
    this.memoryCache.set(key, entry);

    // LocalStorage cache (si demandé)
    if (options.persist) {
      this.persistToStorage(key, entry);
    }

    console.log(`[Cache] SET: ${key} (TTL: ${ttl}ms, Persist: ${options.persist})`);
  }

  /**
   * Récupérer une entrée du cache
   */
  get<T>(key: string): T | null {
    // 1. Vérifier memory cache d'abord
    let entry = this.memoryCache.get(key);

    // 2. Si pas en mémoire, vérifier LocalStorage
    if (!entry) {
      entry = this.loadFromStorage(key);
      if (entry) {
        // Remettre en memory cache
        this.memoryCache.set(key, entry);
      }
    }

    // 3. Vérifier validité
    if (!entry) {
      return null;
    }

    const now = Date.now();
    const age = now - entry.timestamp;

    if (age > entry.ttl) {
      // Expiré
      this.delete(key);
      console.log(`[Cache] MISS (expired): ${key}`);
      return null;
    }

    // 4. Incrémenter hits et retourner
    entry.hits++;
    console.log(`[Cache] HIT: ${key} (hits: ${entry.hits})`);
    return entry.data as T;
  }

  /**
   * Supprimer une entrée
   */
  delete(key: string): void {
    this.memoryCache.delete(key);
    localStorage.removeItem(this.STORAGE_PREFIX + key);
  }

  /**
   * Vider tout le cache
   */
  clear(): void {
    this.memoryCache.clear();
    
    // Supprimer toutes les clés cache du localStorage
    const keys = Object.keys(localStorage);
    for (const key of keys) {
      if (key.startsWith(this.STORAGE_PREFIX)) {
        localStorage.removeItem(key);
      }
    }

    console.log('[Cache] Tout le cache vidé');
  }

  /**
   * Obtenir des statistiques sur le cache
   */
  getStats() {
    const entries = Array.from(this.memoryCache.entries());
    const now = Date.now();

    return {
      totalEntries: this.memoryCache.size,
      validEntries: entries.filter(
        ([_, e]) => now - e.timestamp < e.ttl
      ).length,
      totalHits: entries.reduce((sum, [_, e]) => sum + e.hits, 0),
      averageAge: entries.length
        ? entries.reduce((sum, [_, e]) => sum + (now - e.timestamp), 0) / entries.length
        : 0,
      mostUsed: this.getMostUsedKeys(5),
    };
  }

  /**
   * Invalider les entrées expirées (cleanup)
   */
  cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.memoryCache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.delete(key);
        cleaned++;
      }
    }

    console.log(`[Cache] Nettoyage: ${cleaned} entrées expirées supprimées`);
  }

  // ────────────────────────────────────────────────────────────
  // MÉTHODES UTILITAIRES SPÉCIFIQUES
  // ────────────────────────────────────────────────────────────

  /**
   * Cache pour les réponses Gemini (évite appels répétés)
   */
  cacheGeminiResponse(prompt: string, response: string, userId: string): void {
    const hash = this.hashString(prompt + userId);
    this.set(`gemini_${hash}`, response, {
      ttl: 10 * 60 * 1000, // 10 minutes
      persist: false, // Ne pas persister (données volumineuses)
    });
  }

  getCachedGeminiResponse(prompt: string, userId: string): string | null {
    const hash = this.hashString(prompt + userId);
    return this.get(`gemini_${hash}`);
  }

  /**
   * Cache pour les profils utilisateur
   */
  cacheUserProfile(userId: string, profile: any): void {
    this.set(`profile_${userId}`, profile, {
      ttl: 15 * 60 * 1000, // 15 minutes
      persist: true, // Persister pour offline
    });
  }

  getCachedUserProfile(userId: string): any | null {
    return this.get(`profile_${userId}`);
  }

  /**
   * Cache pour les paramètres système
   */
  cacheSystemSettings(settings: any): void {
    this.set('system_settings', settings, {
      ttl: 30 * 60 * 1000, // 30 minutes
      persist: true,
    });
  }

  getCachedSystemSettings(): any | null {
    return this.get('system_settings');
  }

  // ────────────────────────────────────────────────────────────
  // MÉTHODES PRIVÉES
  // ────────────────────────────────────────────────────────────

  private evictIfNeeded(): void {
    if (this.memoryCache.size < this.MAX_MEMORY_SIZE) {
      return;
    }

    // Stratégie LRU : supprimer l'entrée la moins récemment utilisée
    const entries = Array.from(this.memoryCache.entries());
    
    // Trier par hits (croissant) puis par timestamp (croissant)
    entries.sort((a, b) => {
      if (a[1].hits !== b[1].hits) {
        return a[1].hits - b[1].hits;
      }
      return a[1].timestamp - b[1].timestamp;
    });

    // Supprimer les 10 premières (moins utilisées)
    for (let i = 0; i < 10 && i < entries.length; i++) {
      this.memoryCache.delete(entries[i][0]);
    }

    console.log('[Cache] Éviction: 10 entrées supprimées (LRU)');
  }

  private persistToStorage<T>(key: string, entry: CacheEntry<T>): void {
    try {
      const serialized = JSON.stringify(entry);
      localStorage.setItem(this.STORAGE_PREFIX + key, serialized);
    } catch (error) {
      // QuotaExceededError - LocalStorage plein
      console.warn('[Cache] Impossible de persister:', key, error);
      this.cleanOldestStorageEntries();
    }
  }

  private loadFromStorage(key: string): CacheEntry<any> | null {
    try {
      const raw = localStorage.getItem(this.STORAGE_PREFIX + key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  private cleanOldestStorageEntries(): void {
    const keys = Object.keys(localStorage).filter((k) =>
      k.startsWith(this.STORAGE_PREFIX)
    );

    const entries = keys
      .map((k) => {
        try {
          const data = JSON.parse(localStorage.getItem(k)!);
          return { key: k, timestamp: data.timestamp || 0 };
        } catch {
          return { key: k, timestamp: 0 };
        }
      })
      .sort((a, b) => a.timestamp - b.timestamp);

    // Supprimer les 5 plus anciennes
    for (let i = 0; i < 5 && i < entries.length; i++) {
      localStorage.removeItem(entries[i].key);
    }

    console.log('[Cache] 5 entrées anciennes supprimées du LocalStorage');
  }

  private getMostUsedKeys(limit: number): Array<{ key: string; hits: number }> {
    return Array.from(this.memoryCache.entries())
      .map(([key, entry]) => ({ key, hits: entry.hits }))
      .sort((a, b) => b.hits - a.hits)
      .slice(0, limit);
  }

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }
}

// Singleton
export const cacheService = new CacheService();

// Cleanup automatique toutes les 5 minutes
if (typeof window !== 'undefined') {
  setInterval(() => {
    cacheService.cleanup();
  }, 5 * 60 * 1000);
}
