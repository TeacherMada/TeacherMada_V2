/**
 * @file syncService.ts
 * @description Service de synchronisation background Supabase.
 *
 * CORRECTIONS AUDIT P3 :
 * - Queue NON-BLOQUANTE : traitement par groupes parallèles (profile / session / autres)
 * - Une opération échouée ne bloque plus les autres
 * - Retry exponentiel par opération individuelle, pas global
 * - Meilleure gestion de la concurrence (mutex par groupe)
 *
 * TeacherMada v1.1
 */

import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { lsManager } from '../lib/localStorageManager';

const SYNC_QUEUE_KEY = 'tm_sync_queue_v3';
const MAX_RETRIES = 4;

export type SyncOperationType =
  | 'UPDATE_PROFILE'
  | 'UPSERT_SESSION'
  | 'INSERT_EXAM'
  | 'INSERT_CERT'
  | 'INSERT_NOTIF'
  | 'MARK_NOTIF_READ'
  | 'MARK_ALL_NOTIF_READ'
  | 'DELETE_NOTIF';

interface SyncOperation {
  id: string;
  type: SyncOperationType;
  payload: any;
  timestamp: number;
  retryCount: number;
  groupKey?: string; // Pour le dédoublonnage (ex: 'profile_userId')
}

// Groupes d'opérations exécutés en parallèle entre eux, séquentiellement en interne
const OP_GROUPS: Record<string, SyncOperationType[]> = {
  profile:      ['UPDATE_PROFILE'],
  session:      ['UPSERT_SESSION'],
  exam:         ['INSERT_EXAM', 'INSERT_CERT'],
  notification: ['INSERT_NOTIF', 'MARK_NOTIF_READ', 'MARK_ALL_NOTIF_READ', 'DELETE_NOTIF'],
};

const getGroup = (type: SyncOperationType): string =>
  Object.entries(OP_GROUPS).find(([, types]) => types.includes(type))?.[0] ?? 'other';

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'error';

class SyncService {
  private queue: SyncOperation[] = [];
  private isProcessing = false;
  private processingGroups = new Set<string>(); // Mutex par groupe
  private listeners: ((status: SyncStatus) => void)[] = [];
  private debouncers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor() {
    this.loadQueue();
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        console.info('[SyncService] Connexion rétablie, traitement de la queue...');
        this.processQueue();
      });
      window.addEventListener('offline', () => this.notifyListeners('offline'));

      if (navigator.onLine) {
        setTimeout(() => this.processQueue(), 1500);
      }
    }
  }

  // ─── Queue Persistence ───────────────────────────────────────────────────────

  private loadQueue(): void {
    this.queue = lsManager.safeGetJson<SyncOperation[]>(SYNC_QUEUE_KEY, []);
    // Nettoyage défensif : supprimer les ops invalides
    this.queue = this.queue.filter(op => op?.id && op?.type && op?.payload);
  }

  private saveQueue(): void {
    lsManager.safeSetJson(SYNC_QUEUE_KEY, this.queue);
  }

  // ─── Listeners ──────────────────────────────────────────────────────────────

  public subscribe(callback: (status: SyncStatus) => void): () => void {
    this.listeners.push(callback);
    // Status initial
    const initialStatus = !navigator.onLine ? 'offline'
      : this.queue.length > 0 ? 'syncing'
      : 'synced';
    callback(initialStatus);
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  private notifyListeners(status: SyncStatus): void {
    this.listeners.forEach(cb => {
      try { cb(status); } catch { /* ignoré */ }
    });
  }

  // ─── Ajout à la Queue ────────────────────────────────────────────────────────

  public addToQueue(type: SyncOperationType, payload: any, debounceKey?: string): void {
    if (debounceKey) {
      // Annuler le timer précédent
      const existing = this.debouncers.get(debounceKey);
      if (existing) clearTimeout(existing);

      const timeout = setTimeout(() => {
        this.debouncers.delete(debounceKey);
        this.pushToQueue(type, payload, debounceKey);
      }, 1500); // 1.5s debounce

      this.debouncers.set(debounceKey, timeout);
    } else {
      this.pushToQueue(type, payload);
    }
  }

  private pushToQueue(type: SyncOperationType, payload: any, idOverride?: string): void {
    // Dédoublonnage : si une op avec le même groupKey est déjà en queue et pas encore traitée, la remplacer
    if (idOverride) {
      const existingIdx = this.queue.findIndex(op => op.groupKey === idOverride);
      if (existingIdx !== -1) {
        // Remplacer en préservant retryCount si > 0
        const existing = this.queue[existingIdx];
        this.queue[existingIdx] = {
          ...existing,
          payload, // Mise à jour du payload
          timestamp: Date.now(),
          retryCount: 0, // Reset retry pour la nouvelle valeur
        };
        this.saveQueue();
        this.scheduleProcess();
        return;
      }
    }

    const op: SyncOperation = {
      id: crypto.randomUUID(),
      type,
      payload,
      timestamp: Date.now(),
      retryCount: 0,
      groupKey: idOverride,
    };

    this.queue.push(op);
    this.saveQueue();
    this.scheduleProcess();
  }

  private scheduleProcess(): void {
    // Micro-délai pour batcher les opérations simultanées
    setTimeout(() => this.processQueue(), 50);
  }

  // ─── Traitement de la Queue (NON-BLOQUANT) ────────────────────────────────────

  public async processQueue(): Promise<void> {
    if (!navigator.onLine || !isSupabaseConfigured()) {
      if (this.queue.length > 0) this.notifyListeners('offline');
      return;
    }

    if (this.queue.length === 0) {
      this.notifyListeners('synced');
      return;
    }

    this.notifyListeners('syncing');

    // Grouper les opérations en attente
    const pendingByGroup = new Map<string, SyncOperation[]>();
    for (const op of this.queue) {
      const group = getGroup(op.type);
      if (!pendingByGroup.has(group)) pendingByGroup.set(group, []);
      pendingByGroup.get(group)!.push(op);
    }

    // Lancer les groupes en parallèle (chaque groupe traite en séquentiel)
    const groupPromises = Array.from(pendingByGroup.entries()).map(([group, ops]) =>
      this.processGroup(group, ops)
    );

    await Promise.allSettled(groupPromises);

    if (this.queue.length === 0) {
      this.notifyListeners('synced');
    } else {
      // Il reste des ops (retries en attente)
      this.notifyListeners('offline');
    }
  }

  private async processGroup(group: string, ops: SyncOperation[]): Promise<void> {
    // Mutex par groupe : une seule exécution simultanée par groupe
    if (this.processingGroups.has(group)) return;
    this.processingGroups.add(group);

    try {
      for (const op of ops) {
        // Vérifier que l'op est toujours dans la queue (pas supprimée entre-temps)
        if (!this.queue.find(q => q.id === op.id)) continue;

        const success = await this.executeOperation(op);

        if (success) {
          this.queue = this.queue.filter(q => q.id !== op.id);
          this.saveQueue();
        } else {
          const opInQueue = this.queue.find(q => q.id === op.id);
          if (opInQueue) {
            opInQueue.retryCount++;
            if (opInQueue.retryCount >= MAX_RETRIES) {
              console.error(`[SyncService] Op ${op.id} (${op.type}) abandonnée après ${MAX_RETRIES} tentatives.`);
              this.queue = this.queue.filter(q => q.id !== op.id);
            }
            this.saveQueue();
          }
          // Délai progressif avant retry (sans bloquer les autres groupes)
          const delay = 500 * Math.pow(2, op.retryCount);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    } finally {
      this.processingGroups.delete(group);
    }
  }

  // ─── Exécution des Opérations ────────────────────────────────────────────────

  private async executeOperation(op: SyncOperation): Promise<boolean> {
    try {
      switch (op.type) {
        case 'UPDATE_PROFILE': {
          const { error } = await supabase
            .from('profiles')
            .update(op.payload)
            .eq('id', op.payload.id);
          if (error) console.warn('[SyncService] UPDATE_PROFILE error:', error.message);
          return !error;
        }

        case 'UPSERT_SESSION': {
          const { error } = await supabase
            .from('learning_sessions')
            .upsert(op.payload, { onConflict: 'id' });
          if (error) console.warn('[SyncService] UPSERT_SESSION error:', error.message);
          return !error;
        }

        case 'INSERT_EXAM': {
          const { error } = await supabase
            .from('exam_results')
            .insert([op.payload]);
          // Ignorer les doublons (contrainte unique sur id)
          if (error && error.code === '23505') return true;
          if (error) console.warn('[SyncService] INSERT_EXAM error:', error.message);
          return !error;
        }

        case 'INSERT_CERT': {
          const { error } = await supabase
            .from('certificates')
            .insert([op.payload]);
          if (error && error.code === '23505') return true; // Doublon = OK
          if (error) console.warn('[SyncService] INSERT_CERT error:', error.message);
          return !error;
        }

        case 'INSERT_NOTIF': {
          const { error } = await supabase
            .from('notifications')
            .insert([op.payload]);
          if (error && error.code === '23505') return true;
          if (error) console.warn('[SyncService] INSERT_NOTIF error:', error.message);
          return !error;
        }

        case 'MARK_NOTIF_READ': {
          const { error } = await supabase
            .from('notifications')
            .update({ read: true })
            .eq('id', op.payload.id);
          return !error;
        }

        case 'MARK_ALL_NOTIF_READ': {
          const { error } = await supabase
            .from('notifications')
            .update({ read: true })
            .eq('user_id', op.payload.userId)
            .eq('read', false);
          return !error;
        }

        case 'DELETE_NOTIF': {
          const { error } = await supabase
            .from('notifications')
            .delete()
            .eq('id', op.payload.id);
          return !error;
        }

        default:
          console.warn('[SyncService] Type inconnu:', (op as any).type);
          return true; // Ignorer les ops inconnues
      }
    } catch (e) {
      console.error('[SyncService] Exception exécution:', e);
      return false;
    }
  }

  // ─── Utilitaires Publics ──────────────────────────────────────────────────────

  public getQueueSize(): number {
    return this.queue.length;
  }

  public clearQueue(): void {
    this.queue = [];
    this.saveQueue();
    this.notifyListeners('synced');
  }
}

export const syncService = new SyncService();
