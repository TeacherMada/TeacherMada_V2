-- 1. Create a secure function to check admin status without triggering RLS recursion
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- 2. Drop existing policies on profiles to recreate them safely
-- Note: We drop common policy names. If you have differently named policies causing the issue, 
-- you may need to drop them manually in the Supabase Dashboard.
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON profiles;
DROP POLICY IF EXISTS "Enable read access for all users" ON profiles;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON profiles;
DROP POLICY IF EXISTS "Enable update for users based on id" ON profiles;

-- 3. Recreate safe policies
-- Users can read their own profile, OR admins can read all
CREATE POLICY "Users can view own profile or admins can view all" 
ON profiles FOR SELECT 
USING (auth.uid() = id OR public.is_admin());

-- Users can update their own profile, OR admins can update all
CREATE POLICY "Users can update own profile or admins can update all" 
ON profiles FOR UPDATE 
USING (auth.uid() = id OR public.is_admin());

-- Users can insert their own profile (needed for registration)
CREATE POLICY "Users can insert own profile" 
ON profiles FOR INSERT 
WITH CHECK (auth.uid() = id);

-- Admins can delete profiles
CREATE POLICY "Admins can delete profiles" 
ON profiles FOR DELETE 
USING (public.is_admin());
