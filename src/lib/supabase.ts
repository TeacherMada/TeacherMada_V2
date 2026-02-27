
import { createClient } from '@supabase/supabase-js';

// Récupération sécurisée des variables d'environnement pour Vite (Render compatible)
// @ts-ignore
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
// @ts-ignore
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const isConfigured = supabaseUrl && supabaseAnonKey;

if (!isConfigured) {
    console.warn("⚠️ CONFIGURATION SUPABASE MANQUANTE : Vérifiez vos variables d'environnement VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY sur Render.");
}

// Création du client
// Fix: Bypass LockManager on mobile to prevent "Acquiring lock timed out" errors
// We implement a dummy LockManager that just executes the callback immediately
const debugLock = {
    request: async (name: string, optionsOrFn: any, fn?: any) => {
        // Handle overload: request(name, callback) vs request(name, options, callback)
        const callback = (typeof optionsOrFn === 'function') ? optionsOrFn : fn;
        
        if (!callback) {
            console.error("LockManager polyfill: No callback provided");
            return;
        }

        try {
            return await callback();
        } catch (e) {
            console.error("LockManager polyfill error:", e);
            throw e;
        }
    },
    query: async () => ({ held: [], pending: [] })
};

export const supabase = createClient(
    supabaseUrl || 'https://placeholder.supabase.co', 
    supabaseAnonKey || 'placeholder',
    {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            // @ts-ignore - Bypass lock for mobile stability
            lock: debugLock
        }
    }
);

export const isSupabaseConfigured = () => !!isConfigured;
