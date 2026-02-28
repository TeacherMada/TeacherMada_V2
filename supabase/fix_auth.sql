-- 1. Autoriser la lecture publique des profils (Nécessaire pour la connexion par nom d'utilisateur)
DROP POLICY IF EXISTS "Users can view own profile or admins can view all" ON profiles;
DROP POLICY IF EXISTS "Enable read access for all users" ON profiles;
CREATE POLICY "Enable read access for all users" ON profiles FOR SELECT USING (true);

-- 2. Autoriser l'insertion (utile si le client le fait directement)
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON profiles;
CREATE POLICY "Enable insert for authenticated users only" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- 3. Créer un Trigger pour générer automatiquement le profil à l'inscription (Sécurisé, contourne les RLS)
-- Cela garantit que le profil est toujours créé même si le client échoue à cause des règles de sécurité
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, username, email, role, credits, is_suspended, created_at, updated_at)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    new.email,
    'user',
    6, -- Crédits de départ
    false,
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
