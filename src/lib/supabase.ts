
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
const customLock = {
    acquire: async (name: string, fn: () => Promise<any>) => {
        // Immediately execute without locking
        return await fn();
    }
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
            lock: customLock
        }
    }
);

export const isSupabaseConfigured = () => !!isConfigured;
