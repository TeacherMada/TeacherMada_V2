-- ==========================================
-- TEACHERMADA V4 - ULTRA LIGHT & SECURE
-- ==========================================
-- Objectifs : Zéro surcharge, compatible Free Tier, 100% sécurisé.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- 1. TABLES
-- ==========================================

-- PROFILES (Allégé : Plus d'XP, plus de stats massives)
CREATE TABLE public.profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    credits INTEGER DEFAULT 6 CHECK (credits >= 0),
    preferences JSONB DEFAULT '{"targetLanguage": "", "level": ""}'::jsonb,
    is_suspended BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- USER WEAKNESS (Remplace le vocabulaire lourd)
-- Mémoire intelligente légère : stocke juste les erreurs fréquentes
CREATE TABLE public.user_weakness (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    category TEXT NOT NULL, -- ex: 'grammar', 'vocabulary', 'pronunciation'
    tag TEXT NOT NULL,      -- ex: 'past_tense', 'ser_vs_estar', 'word_apple'
    error_count INTEGER DEFAULT 1,
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, category, tag)
);

-- LEARNING SESSIONS (Unifiée et limitée)
CREATE TABLE public.learning_sessions (
    id TEXT PRIMARY KEY, -- ex: session_userId_lesson
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('lesson', 'exercise', 'dialogue', 'exam', 'call')),
    language TEXT NOT NULL,
    level TEXT NOT NULL,
    messages JSONB DEFAULT '[]'::jsonb, -- Le client/serveur ne gardera que les 20 derniers
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- SYSTEM SETTINGS (Admin uniquement)
CREATE TABLE public.system_settings (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    credit_price INTEGER DEFAULT 50,
    valid_coupons JSONB DEFAULT '[]'::jsonb, -- [{code: "PROMO10", amount: 10}]
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- 2. INDEXES (Performances)
-- ==========================================
CREATE INDEX idx_weakness_user ON public.user_weakness(user_id);
CREATE INDEX idx_sessions_user ON public.learning_sessions(user_id);
CREATE INDEX idx_sessions_updated ON public.learning_sessions(updated_at);

-- ==========================================
-- 3. ROW LEVEL SECURITY (RLS)
-- ==========================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_weakness ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- Profiles
CREATE POLICY "Users view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users update own preferences" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Admins manage all profiles" ON public.profiles FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- Weakness
CREATE POLICY "Users manage own weakness" ON public.user_weakness FOR ALL USING (auth.uid() = user_id);

-- Sessions
CREATE POLICY "Users manage own sessions" ON public.learning_sessions FOR ALL USING (auth.uid() = user_id);

-- Settings
CREATE POLICY "Anyone can read settings" ON public.system_settings FOR SELECT USING (true);
CREATE POLICY "Admins manage settings" ON public.system_settings FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- ==========================================
-- 4. FONCTIONS RPC (SÉCURITÉ & LOGIQUE SERVEUR)
-- ==========================================

-- A. Consommation de crédits (100% sécurisé, basé sur auth.uid)
CREATE OR REPLACE FUNCTION public.consume_credits(p_amount INT)
RETURNS INTEGER AS $$
DECLARE
  v_current_credits INT;
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Non autorisé'; END IF;

  -- Verrouille la ligne pour éviter les conditions de course (double clic)
  SELECT credits INTO v_current_credits FROM public.profiles WHERE id = v_user_id FOR UPDATE;
  
  IF v_current_credits >= p_amount THEN
    UPDATE public.profiles SET credits = credits - p_amount WHERE id = v_user_id
    RETURNING credits INTO v_current_credits;
    RETURN v_current_credits; -- Retourne le nouveau solde
  ELSE
    RAISE EXCEPTION 'Crédits insuffisants';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- B. Ajout de crédits (Admin uniquement)
CREATE OR REPLACE FUNCTION public.admin_add_credits(p_target_user UUID, p_amount INT)
RETURNS INTEGER AS $$
DECLARE
  v_admin_role TEXT;
  v_new_credits INT;
BEGIN
  SELECT role INTO v_admin_role FROM public.profiles WHERE id = auth.uid();
  IF v_admin_role != 'admin' THEN RAISE EXCEPTION 'Accès refusé'; END IF;

  UPDATE public.profiles SET credits = credits + p_amount WHERE id = p_target_user
  RETURNING credits INTO v_new_credits;
  RETURN v_new_credits;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- C. Purge automatique des vieilles données (> 30 jours)
CREATE OR REPLACE FUNCTION public.purge_old_data()
RETURNS VOID AS $$
BEGIN
  -- Supprime les sessions inactives depuis plus de 30 jours
  DELETE FROM public.learning_sessions WHERE updated_at < NOW() - INTERVAL '30 days';
  -- Supprime les faiblesses non revues depuis plus de 60 jours (optionnel)
  DELETE FROM public.user_weakness WHERE last_seen < NOW() - INTERVAL '60 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- 5. TRIGGERS
-- ==========================================

-- Auto-création de profil
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username, email, credits)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    NEW.email,
    6
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();
CREATE TRIGGER set_sessions_updated_at BEFORE UPDATE ON public.learning_sessions FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- Init settings
INSERT INTO public.system_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
