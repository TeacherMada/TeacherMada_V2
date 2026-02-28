-- ==========================================
-- TEACHERMADA V3 - SUPABASE SCHEMA REBUILD
-- ==========================================
-- Ce script crée une structure de base de données propre, optimisée et sécurisée.
-- À exécuter dans l'éditeur SQL de votre NOUVEAU projet Supabase.

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. TABLES

-- Table: profiles
CREATE TABLE public.profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    full_name TEXT,
    email TEXT NOT NULL,
    phone_number TEXT,
    role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    credits INTEGER DEFAULT 6 CHECK (credits >= 0),
    xp INTEGER DEFAULT 0 CHECK (xp >= 0),
    preferences JSONB DEFAULT '{}'::jsonb,
    stats JSONB DEFAULT '{"lessonsCompleted": 0, "exercisesCompleted": 0, "dialoguesCompleted": 0}'::jsonb,
    ai_memory JSONB DEFAULT '{"lastUpdate": 0}'::jsonb,
    free_usage JSONB DEFAULT '{"count": 0, "lastResetWeek": ""}'::jsonb,
    is_suspended BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: user_vocabulary
CREATE TABLE public.user_vocabulary (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    word TEXT NOT NULL,
    translation TEXT NOT NULL,
    example TEXT,
    mastered BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, word)
);

-- Table: learning_sessions
CREATE TABLE public.learning_sessions (
    id TEXT PRIMARY KEY, -- Format: tm_v3_session_{user_id}_{lang}_{level}_{mode}
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    target_language TEXT NOT NULL,
    level TEXT NOT NULL,
    mode TEXT NOT NULL,
    messages JSONB DEFAULT '[]'::jsonb,
    progress INTEGER DEFAULT 0,
    score INTEGER DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: notifications
CREATE TABLE public.notifications (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    read BOOLEAN DEFAULT false,
    data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: exam_results
CREATE TABLE public.exam_results (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    language TEXT NOT NULL,
    level TEXT NOT NULL,
    score NUMERIC NOT NULL,
    total_questions INTEGER NOT NULL,
    passed BOOLEAN NOT NULL,
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: certificates
CREATE TABLE public.certificates (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    user_name TEXT NOT NULL,
    user_full_name TEXT,
    language TEXT NOT NULL,
    level TEXT NOT NULL,
    exam_id UUID REFERENCES public.exam_results(id),
    issue_date TIMESTAMPTZ DEFAULT NOW(),
    validation_hash TEXT UNIQUE NOT NULL,
    qr_code_data TEXT,
    score NUMERIC,
    global_score NUMERIC,
    skill_scores JSONB
);

-- Table: admin_requests
CREATE TABLE public.admin_requests (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    type TEXT NOT NULL,
    amount INTEGER,
    message TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: system_settings
CREATE TABLE public.system_settings (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- Single row table
    api_keys JSONB DEFAULT '[]'::jsonb,
    active_model TEXT DEFAULT 'gemini-2.5-flash',
    credit_price INTEGER DEFAULT 50,
    custom_languages JSONB DEFAULT '[]'::jsonb,
    valid_transaction_refs JSONB DEFAULT '[]'::jsonb,
    admin_contact JSONB DEFAULT '{"telma": "0349310268", "airtel": "0333878420", "orange": "0326979017"}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. ROW LEVEL SECURITY (RLS)

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_vocabulary ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- Policies: Profiles
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Admins can view all profiles" ON public.profiles FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can update all profiles" ON public.profiles FOR UPDATE USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- Policies: User Vocabulary
CREATE POLICY "Users manage own vocabulary" ON public.user_vocabulary FOR ALL USING (auth.uid() = user_id);

-- Policies: Learning Sessions
CREATE POLICY "Users manage own sessions" ON public.learning_sessions FOR ALL USING (auth.uid() = user_id);

-- Policies: Notifications
CREATE POLICY "Users manage own notifications" ON public.notifications FOR ALL USING (auth.uid() = user_id);

-- Policies: Exam Results
CREATE POLICY "Users view own exams" ON public.exam_results FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own exams" ON public.exam_results FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Policies: Certificates
CREATE POLICY "Anyone can view certificates" ON public.certificates FOR SELECT USING (true);
CREATE POLICY "Users insert own certificates" ON public.certificates FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Policies: Admin Requests
CREATE POLICY "Users manage own requests" ON public.admin_requests FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Admins manage all requests" ON public.admin_requests FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- Policies: System Settings
CREATE POLICY "Anyone can view settings" ON public.system_settings FOR SELECT USING (true);
CREATE POLICY "Admins can update settings" ON public.system_settings FOR UPDATE USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- 4. TRIGGERS & FUNCTIONS

-- Trigger: Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username, email, phone_number, credits)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'phone_number', ''),
    6 -- Welcome credits
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Trigger: Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();
CREATE TRIGGER set_sessions_updated_at BEFORE UPDATE ON public.learning_sessions FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- RPC: Consume Credits (Atomic & Secure)
CREATE OR REPLACE FUNCTION public.consume_credits(p_user_id UUID, p_amount INT)
RETURNS BOOLEAN AS $$
DECLARE
  current_credits INT;
BEGIN
  SELECT credits INTO current_credits FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF current_credits >= p_amount THEN
    UPDATE public.profiles SET credits = credits - p_amount WHERE id = p_user_id;
    RETURN true;
  ELSE
    RETURN false;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: Add Credits (Admin or System)
CREATE OR REPLACE FUNCTION public.add_credits(p_user_id UUID, p_amount INT)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE public.profiles SET credits = credits + p_amount WHERE id = p_user_id;
  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. INITIAL DATA
INSERT INTO public.system_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
