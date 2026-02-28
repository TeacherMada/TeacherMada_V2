
import { createClient } from '@supabase/supabase-js';

// Récupération sécurisée des variables d'environnement pour Vite (Render compatible)
// @ts-ignore
export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
// @ts-ignore
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const isConfigured = supabaseUrl && supabaseAnonKey;

if (!isConfigured) {
    console.warn("⚠️ CONFIGURATION SUPABASE MANQUANTE : Vérifiez vos variables d'environnement VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY sur Render.");
}

// Création du client
export const supabase = createClient(
    supabaseUrl || 'https://placeholder.supabase.co', 
    supabaseAnonKey || 'placeholder',
    {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
        }
    }
);

export const isSupabaseConfigured = () => !!isConfigured;
