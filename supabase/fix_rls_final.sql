-- 1. Drop the problematic function that causes recursion
DROP FUNCTION IF EXISTS public.is_admin();

-- 2. Drop ALL policies on the profiles table to start fresh
DO $$ 
DECLARE 
    pol record;
BEGIN 
    FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'profiles' AND schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.profiles', pol.policyname);
    END LOOP;
END $$;

-- 3. Create simple, non-recursive policies
-- Allow users to read their own profile
CREATE POLICY "Users can view own profile" 
ON public.profiles FOR SELECT 
USING (auth.uid() = id);

-- Allow users to update their own profile
CREATE POLICY "Users can update own profile" 
ON public.profiles FOR UPDATE 
USING (auth.uid() = id);

-- Allow users to insert their own profile
CREATE POLICY "Users can insert own profile" 
ON public.profiles FOR INSERT 
WITH CHECK (auth.uid() = id);

-- Allow admins to read all profiles (using raw_user_meta_data instead of querying the table)
CREATE POLICY "Admins can view all profiles" 
ON public.profiles FOR SELECT 
USING (
  (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
);

-- Allow admins to update all profiles
CREATE POLICY "Admins can update all profiles" 
ON public.profiles FOR UPDATE 
USING (
  (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
);

-- Allow admins to delete profiles
CREATE POLICY "Admins can delete profiles" 
ON public.profiles FOR DELETE 
USING (
  (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
);

-- Note: If you need a user to be an admin, you must update their auth.users metadata:
-- update auth.users set raw_user_meta_data = jsonb_set(raw_user_meta_data, '{role}', '"admin"') where id = '...';
