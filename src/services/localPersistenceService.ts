/**
 * localPersistenceService.ts
 * ─────────────────────────────────────────────────────────────
 * Service dédié au stockage LOCAL (localStorage) des historiques
 * de conversation et des préférences utilisateur.
 *
 * • 100 % hors-ligne — aucune dépendance Supabase
 * • Anti-QuotaExceededError : éviction automatique des + anciennes sessions
 * • Limite : 200 messages / session, 10 sessions max / utilisateur
 * ─────────────────────────────────────────────────────────────
 */

import { ChatMessage, UserPreferences } from '../types';

const HISTORY_PREFIX = 'tm_local_hist_';
const PREFS_PREFIX   = 'tm_local_prefs_';
const MAX_MESSAGES   = 200;
const MAX_SESSIONS   = 10;

const safeSet = (key: string, value: string): boolean => {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch (e: any) {
        if (e?.name === 'QuotaExceededError' || e?.code === 22) {
            console.warn('[LocalPersistence] Quota dépassé — éviction auto...');
            const entries = Object.keys(localStorage)
                .filter(k => k.startsWith(HISTORY_PREFIX))
                .map(k => {
                    try { return { key: k, ts: JSON.parse(localStorage.getItem(k) || '{}').updatedAt || 0 }; }
                    catch { return { key: k, ts: 0 }; }
                })
                .sort((a, b) => a.ts - b.ts);
            if (entries.length > 0) localStorage.removeItem(entries[0].key);
            try { localStorage.setItem(key, value); return true; } catch { return false; }
        }
        return false;
    }
};

const histKey = (userId: string, sessionKey: string) =>
    `${HISTORY_PREFIX}${userId}_${sessionKey.replace(/[\s/\\'"]/g, '_')}`;

const prefKey = (userId: string) => `${PREFS_PREFIX}${userId}`;

export const localPersistenceService = {

    saveHistory(userId: string, sessionKey: string, messages: ChatMessage[]): void {
        if (!userId || !sessionKey) return;
        const trimmed = messages.length > MAX_MESSAGES
            ? [messages[0], ...messages.slice(-(MAX_MESSAGES - 1))]
            : [...messages];
        safeSet(histKey(userId, sessionKey), JSON.stringify({
            sessionKey,
            messages: trimmed,
            updatedAt: Date.now()
        }));
        this.enforceSessionLimit(userId);
    },

    loadHistory(userId: string, sessionKey: string): ChatMessage[] {
        if (!userId || !sessionKey) return [];
        try {
            const raw = localStorage.getItem(histKey(userId, sessionKey));
            if (!raw) return [];
            const data = JSON.parse(raw);
            return Array.isArray(data.messages) ? data.messages : [];
        } catch { return []; }
    },

    clearHistory(userId: string, sessionKey: string): void {
        localStorage.removeItem(histKey(userId, sessionKey));
    },

    clearAllHistory(userId: string): void {
        Object.keys(localStorage)
            .filter(k => k.startsWith(`${HISTORY_PREFIX}${userId}_`))
            .forEach(k => localStorage.removeItem(k));
    },

    listSessions(userId: string): { sessionKey: string; messageCount: number; updatedAt: number }[] {
        return Object.keys(localStorage)
            .filter(k => k.startsWith(`${HISTORY_PREFIX}${userId}_`))
            .map(k => {
                try {
                    const d = JSON.parse(localStorage.getItem(k) || '{}');
                    return { sessionKey: d.sessionKey || k, messageCount: d.messages?.length || 0, updatedAt: d.updatedAt || 0 };
                } catch { return null; }
            })
            .filter(Boolean) as any[];
    },

    enforceSessionLimit(userId: string): void {
        const keys = Object.keys(localStorage)
            .filter(k => k.startsWith(`${HISTORY_PREFIX}${userId}_`));
        if (keys.length <= MAX_SESSIONS) return;
        const sorted = keys
            .map(k => {
                try { return { key: k, ts: JSON.parse(localStorage.getItem(k) || '{}').updatedAt || 0 }; }
                catch { return { key: k, ts: 0 }; }
            })
            .sort((a, b) => a.ts - b.ts);
        sorted.slice(0, keys.length - MAX_SESSIONS).forEach(s => localStorage.removeItem(s.key));
    },

    savePreferences(userId: string, prefs: Partial<UserPreferences> & Record<string, any>): void {
        if (!userId) return;
        safeSet(prefKey(userId), JSON.stringify({ ...prefs, _savedAt: Date.now() }));
    },

    loadPreferences(userId: string): (Partial<UserPreferences> & Record<string, any>) | null {
        if (!userId) return null;
        try {
            const raw = localStorage.getItem(prefKey(userId));
            return raw ? JSON.parse(raw) : null;
        } catch { return null; }
    },

    clearPreferences(userId: string): void {
        localStorage.removeItem(prefKey(userId));
    },

    getStorageUsageKb(userId: string): number {
        let total = 0;
        Object.keys(localStorage)
            .filter(k => k.startsWith(`${HISTORY_PREFIX}${userId}_`) || k === prefKey(userId))
            .forEach(k => { total += (localStorage.getItem(k) || '').length; });
        return Math.round(total / 1024);
    },

    clearAll(userId: string): void {
        this.clearAllHistory(userId);
        this.clearPreferences(userId);
    },
};
