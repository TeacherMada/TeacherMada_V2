import { supabase, isSupabaseConfigured } from "../lib/supabase";

const SYNC_QUEUE_KEY = 'tm_sync_queue_v2';
const MAX_RETRIES = 5;

type SyncOperationType = 
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
}

class SyncService {
    private queue: SyncOperation[] = [];
    private isProcessing = false;
    private listeners: ((status: 'synced' | 'syncing' | 'offline' | 'error') => void)[] = [];
    private debouncers: Map<string, NodeJS.Timeout> = new Map();

    constructor() {
        this.loadQueue();
        if (typeof window !== 'undefined') {
            window.addEventListener('online', () => this.processQueue());
            window.addEventListener('offline', () => this.notifyListeners('offline'));
            // Try to process on load if online
            if (navigator.onLine) {
                setTimeout(() => this.processQueue(), 1000);
            }
        }
    }

    private loadQueue() {
        try {
            const stored = localStorage.getItem(SYNC_QUEUE_KEY);
            this.queue = stored ? JSON.parse(stored) : [];
        } catch (e) {
            this.queue = [];
        }
    }

    private saveQueue() {
        localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(this.queue));
    }

    public subscribe(callback: (status: 'synced' | 'syncing' | 'offline' | 'error') => void) {
        this.listeners.push(callback);
        // Initial status
        callback(this.queue.length > 0 ? (this.isProcessing ? 'syncing' : 'offline') : 'synced');
        return () => {
            this.listeners = this.listeners.filter(cb => cb !== callback);
        };
    }

    private notifyListeners(status: 'synced' | 'syncing' | 'offline' | 'error') {
        this.listeners.forEach(cb => cb(status));
    }

    public async addToQueue(type: SyncOperationType, payload: any, debounceKey?: string) {
        // Debounce logic: If a pending operation exists with the same key, replace it or delay
        if (debounceKey) {
            // Remove existing pending op with same key to avoid stale overwrites in queue
            this.queue = this.queue.filter(op => op.id !== debounceKey);
            
            // Clear existing timeout
            if (this.debouncers.has(debounceKey)) {
                clearTimeout(this.debouncers.get(debounceKey)!);
            }

            // Schedule addition
            const timeout = setTimeout(() => {
                this.pushToQueue(type, payload, debounceKey);
                this.debouncers.delete(debounceKey);
            }, 2000); // 2s debounce for high frequency updates
            
            this.debouncers.set(debounceKey, timeout);
        } else {
            this.pushToQueue(type, payload);
        }
    }

    private pushToQueue(type: SyncOperationType, payload: any, idOverride?: string) {
        const op: SyncOperation = {
            id: idOverride || crypto.randomUUID(),
            type,
            payload,
            timestamp: Date.now(),
            retryCount: 0
        };
        this.queue.push(op);
        this.saveQueue();
        this.processQueue();
    }

    public async processQueue() {
        if (this.isProcessing) return;
        
        if (this.queue.length === 0) {
            this.notifyListeners('synced');
            return;
        }

        if (!navigator.onLine || !isSupabaseConfigured()) {
            this.notifyListeners('offline');
            return;
        }

        this.isProcessing = true;
        this.notifyListeners('syncing');

        // Process one by one
        try {
            const currentOp = this.queue[0];
            const success = await this.executeOperation(currentOp);
            
            if (success) {
                this.queue.shift(); // Remove successful op
                this.saveQueue();
                this.isProcessing = false;
                
                if (this.queue.length > 0) {
                    // Continue processing next item immediately
                    this.processQueue(); 
                } else {
                    this.notifyListeners('synced');
                }
            } else {
                // Handle failure (retry logic)
                currentOp.retryCount++;
                if (currentOp.retryCount >= MAX_RETRIES) {
                    console.error(`Sync operation ${currentOp.id} failed permanently after ${MAX_RETRIES} attempts.`);
                    this.queue.shift(); // Drop it to unblock queue
                } else {
                    // Move to end of queue or delay? 
                    // Delay before retrying same op
                    await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, currentOp.retryCount)));
                }
                this.saveQueue();
                this.isProcessing = false;
                
                // Retry loop continues if we didn't drop it, or moves to next
                if (this.queue.length > 0) this.processQueue();
            }
        } catch (e) {
            console.error("Sync processing error:", e);
            this.notifyListeners('error');
            this.isProcessing = false;
        }
    }

    private async executeOperation(op: SyncOperation): Promise<boolean> {
        try {
            switch (op.type) {
                case 'UPDATE_PROFILE':
                    const { error: pErr } = await supabase.from('profiles').update(op.payload).eq('id', op.payload.id);
                    return !pErr;
                case 'UPSERT_SESSION':
                    const { error: sErr } = await supabase.from('learning_sessions').upsert(op.payload);
                    return !sErr;
                case 'INSERT_EXAM':
                    const { error: eErr } = await supabase.from('exam_results').insert([op.payload]);
                    return !eErr;
                case 'INSERT_CERT':
                    const { error: cErr } = await supabase.from('certificates').insert([op.payload]);
                    return !cErr;
                case 'INSERT_NOTIF':
                    const { error: nErr } = await supabase.from('notifications').insert([op.payload]);
                    return !nErr;
                case 'MARK_NOTIF_READ':
                    const { error: mrErr } = await supabase.from('notifications').update({ read: true }).eq('id', op.payload.id);
                    return !mrErr;
                case 'MARK_ALL_NOTIF_READ':
                    const { error: marErr } = await supabase.from('notifications').update({ read: true }).eq('user_id', op.payload.userId);
                    return !marErr;
                case 'DELETE_NOTIF':
                    const { error: dErr } = await supabase.from('notifications').delete().eq('id', op.payload.id);
                    return !dErr;
                default:
                    return true;
            }
        } catch (e) {
            console.error("Execute operation exception:", e);
            return false;
        }
    }
}

export const syncService = new SyncService();
