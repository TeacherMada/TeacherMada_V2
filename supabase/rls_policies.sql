-- ========================================================================================
-- SÉCURITÉ DE PRODUCTION : ROW LEVEL SECURITY (RLS)
-- À copier et exécuter dans l'éditeur SQL de votre tableau de bord Supabase
-- ========================================================================================

-- 1. Activer RLS sur toutes les tables sensibles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_vocabulary ENABLE ROW LEVEL SECURITY;

-- 2. Politiques pour la table PROFILES
-- Les utilisateurs peuvent lire uniquement leur propre profil
CREATE POLICY "Users can view own profile" 
ON profiles FOR SELECT 
USING (auth.uid() = id);

-- Les utilisateurs peuvent mettre à jour uniquement leur propre profil
CREATE POLICY "Users can update own profile" 
ON profiles FOR UPDATE 
USING (auth.uid() = id);

-- (L'insertion est souvent gérée par un trigger côté serveur lors du SignUp, 
-- mais si le client le fait, on l'autorise uniquement pour son propre ID)
CREATE POLICY "Users can insert own profile" 
ON profiles FOR INSERT 
WITH CHECK (auth.uid() = id);


-- 3. Politiques pour EXAM_RESULTS
CREATE POLICY "Users can view own exam results" 
ON exam_results FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own exam results" 
ON exam_results FOR INSERT 
WITH CHECK (auth.uid() = user_id);


-- 4. Politiques pour CERTIFICATES
-- Les certificats peuvent être publics (pour la vérification par un employeur)
CREATE POLICY "Certificates are viewable by everyone" 
ON certificates FOR SELECT 
USING (true);

CREATE POLICY "Users can insert own certificates" 
ON certificates FOR INSERT 
WITH CHECK (auth.uid() = user_id);


-- 5. Politiques pour LEARNING_SESSIONS
CREATE POLICY "Users can view own sessions" 
ON learning_sessions FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert/update own sessions" 
ON learning_sessions FOR ALL 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);


-- 6. Politiques pour NOTIFICATIONS
CREATE POLICY "Users can manage own notifications" 
ON notifications FOR ALL 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);


-- 7. Politiques pour USER_VOCABULARY
CREATE POLICY "Users can manage own vocabulary" 
ON user_vocabulary FOR ALL 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- ========================================================================================
-- FIN DU SCRIPT DE SÉCURITÉ
-- ========================================================================================
