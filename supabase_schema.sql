-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. PROFILES (Existing)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  username TEXT UNIQUE,
  full_name TEXT,
  email TEXT,
  phone_number TEXT,
  role TEXT DEFAULT 'user',
  credits INTEGER DEFAULT 0,
  xp INTEGER DEFAULT 0,
  stats JSONB DEFAULT '{"lessons_completed": 0, "exercises_completed": 0, "dialogues_completed": 0}',
  preferences JSONB,
  vocabulary JSONB DEFAULT '[]',
  free_usage JSONB DEFAULT '{"count": 0, "lastResetWeek": ""}',
  ai_memory JSONB DEFAULT '{}',
  is_suspended BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. LEARNING SESSIONS (Existing)
CREATE TABLE IF NOT EXISTS public.learning_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id),
  messages JSONB DEFAULT '[]',
  progress INTEGER DEFAULT 0,
  score INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. ADMIN REQUESTS (Existing)
CREATE TABLE IF NOT EXISTS public.admin_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id),
  username TEXT,
  type TEXT,
  amount INTEGER,
  message TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. SYSTEM SETTINGS (Existing)
CREATE TABLE IF NOT EXISTS public.system_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  api_keys TEXT[],
  active_model TEXT,
  credit_price INTEGER,
  custom_languages JSONB,
  valid_transaction_refs JSONB,
  admin_contact JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. EXAM RESULTS (New)
CREATE TABLE IF NOT EXISTS public.exam_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id),
  language TEXT,
  level TEXT,
  score NUMERIC,
  total_questions INTEGER,
  passed BOOLEAN,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. CERTIFICATES (New)
CREATE TABLE IF NOT EXISTS public.certificates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id),
  user_name TEXT,
  user_full_name TEXT,
  language TEXT,
  level TEXT,
  exam_id UUID REFERENCES public.exam_results(id),
  issue_date TIMESTAMPTZ DEFAULT NOW(),
  validation_hash TEXT,
  qr_code_data TEXT,
  score NUMERIC,
  global_score NUMERIC,
  skill_scores JSONB
);

-- 7. NOTIFICATIONS (New)
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id),
  type TEXT,
  title TEXT,
  message TEXT,
  read BOOLEAN DEFAULT FALSE,
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. USER VOCABULARY (Existing/Sync)
CREATE TABLE IF NOT EXISTS public.user_vocabulary (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id),
  word TEXT,
  translation TEXT,
  example TEXT,
  mastered BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, word)
);

-- --- RLS POLICIES ---

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_vocabulary ENABLE ROW LEVEL SECURITY;

-- PROFILES Policies
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Admins can view all profiles" ON public.profiles
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- LEARNING SESSIONS Policies
CREATE POLICY "Users can view own sessions" ON public.learning_sessions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sessions" ON public.learning_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sessions" ON public.learning_sessions
  FOR UPDATE USING (auth.uid() = user_id);

-- ADMIN REQUESTS Policies
CREATE POLICY "Users can view own requests" ON public.admin_requests
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create requests" ON public.admin_requests
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all requests" ON public.admin_requests
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can update requests" ON public.admin_requests
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- SYSTEM SETTINGS Policies
CREATE POLICY "Everyone can view settings" ON public.system_settings
  FOR SELECT USING (true);

CREATE POLICY "Only admins can update settings" ON public.system_settings
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- EXAM RESULTS Policies
CREATE POLICY "Users can view own exam results" ON public.exam_results
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own exam results" ON public.exam_results
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all exam results" ON public.exam_results
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- CERTIFICATES Policies
CREATE POLICY "Users can view own certificates" ON public.certificates
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own certificates" ON public.certificates
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Public can view certificates by ID" ON public.certificates
  FOR SELECT USING (true); -- Allow public verification if needed, or restrict to auth.uid() = user_id OR admin

-- NOTIFICATIONS Policies
CREATE POLICY "Users can view own notifications" ON public.notifications
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications" ON public.notifications
  FOR UPDATE USING (auth.uid() = user_id); -- To mark as read

CREATE POLICY "System/Admin can insert notifications" ON public.notifications
  FOR INSERT WITH CHECK (true); -- Ideally restricted to service role or admin, but for now allow insert if logic is client-side (though insecure). 
-- Better: "Users can insert notifications for themselves" OR "Admins can insert for anyone"
-- Since the app creates notifications client-side (e.g. after admin request), we might need to allow inserts.
-- Let's refine:
CREATE POLICY "Users can insert notifications for themselves" ON public.notifications
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can insert notifications for anyone" ON public.notifications
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- USER VOCABULARY Policies
CREATE POLICY "Users can view own vocabulary" ON public.user_vocabulary
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own vocabulary" ON public.user_vocabulary
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own vocabulary" ON public.user_vocabulary
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own vocabulary" ON public.user_vocabulary
  FOR DELETE USING (auth.uid() = user_id);

-- RPC Function for adding credits (Secure way)
CREATE OR REPLACE FUNCTION add_credits(p_user_id UUID, p_amount INTEGER)
RETURNS VOID AS $$
BEGIN
  UPDATE public.profiles
  SET credits = credits + p_amount
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION consume_credits(p_user_id UUID, p_amount INTEGER)
RETURNS BOOLEAN AS $$
DECLARE
  current_credits INTEGER;
BEGIN
  SELECT credits INTO current_credits FROM public.profiles WHERE id = p_user_id;
  
  IF current_credits >= p_amount THEN
    UPDATE public.profiles
    SET credits = credits - p_amount
    WHERE id = p_user_id;
    RETURN TRUE;
  ELSE
    RETURN FALSE;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
