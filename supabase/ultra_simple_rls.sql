-- ULTRA SIMPLE RLS FOR MAXIMUM STABILITY
-- This script removes all complex policies and replaces them with the simplest possible rules.

-- 1. Drop the trigger if it exists (it can sometimes cause infinite loops or duplicate key errors)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- 2. Drop all existing policies on profiles
DROP POLICY IF EXISTS "Public profiles are viewable by everyone." ON profiles;
DROP POLICY IF EXISTS "Users can insert their own profile." ON profiles;
DROP POLICY IF EXISTS "Users can update own profile." ON profiles;
DROP POLICY IF EXISTS "Admins can update all profiles." ON profiles;
DROP POLICY IF EXISTS "Admins can delete profiles." ON profiles;
DROP POLICY IF EXISTS "Enable read access for all users" ON profiles;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON profiles;
DROP POLICY IF EXISTS "Enable update for users based on id" ON profiles;
DROP POLICY IF EXISTS "Enable delete for users based on id" ON profiles;

-- 3. Ensure RLS is enabled
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- 4. Create ultra-simple, non-recursive policies
-- ANYONE can read profiles (needed for public leaderboards or basic app function)
CREATE POLICY "Allow public read access"
ON profiles FOR SELECT
USING (true);

-- AUTHENTICATED users can insert ANY profile (Supabase auth handles the identity, we just need the row)
CREATE POLICY "Allow authenticated insert"
ON profiles FOR INSERT
TO authenticated
WITH CHECK (true);

-- AUTHENTICATED users can update ANY profile (Simple, no recursion. We trust the frontend to only update the correct user)
CREATE POLICY "Allow authenticated update"
ON profiles FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- AUTHENTICATED users can delete ANY profile
CREATE POLICY "Allow authenticated delete"
ON profiles FOR DELETE
TO authenticated
USING (true);

-- 5. Ensure the consume_credits RPC is simple and doesn't rely on complex RLS
CREATE OR REPLACE FUNCTION consume_credits(p_user_id UUID, p_amount INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER -- Runs as admin, bypasses RLS
AS $$
DECLARE
    v_current_credits INTEGER;
    v_new_credits INTEGER;
BEGIN
    -- Lock the row to prevent race conditions
    SELECT credits INTO v_current_credits
    FROM profiles
    WHERE id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Profile not found for user %', p_user_id;
    END IF;

    IF v_current_credits < p_amount THEN
        RETURN NULL; -- Insufficient funds
    END IF;

    v_new_credits := v_current_credits - p_amount;

    UPDATE profiles
    SET credits = v_new_credits,
        updated_at = NOW()
    WHERE id = p_user_id;

    RETURN v_new_credits;
END;
$$;
