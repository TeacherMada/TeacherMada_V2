/**
 * storageService.ts — TeacherMada v3 FIXED
 * ──────────────────────────────────────────
 * Corrections :
 * 1. Login : RPC get_email_by_identifier + messages d'erreur précis
 * 2. deductCredits : gère réponse JSONB du RPC (plus INTEGER)
 * 3. addCredits : idem JSONB
 * 4. adminDeductCredits : nouveau via admin_deduct_credits RPC
 * 5. logout : ne supprime PLUS les sessions (historique préservé)
 * 6. Realtime : crédits temps-réel via Supabase
 * 7. Admin : deleteUser, updateUser, suspendUser via RPCs sécurisés
 */

import { supabase, isSupabaseConfigured } from "../lib/supabase";
import {
  UserProfile, UserPreferences, LearningSession,
  AdminRequest, SystemSettings, CouponCode,
  ExamResult, Certificate, SmartNotification, UserWeakness
} from "../types";
import { toast } from "../components/Toaster";
import { syncService } from "./syncService";

// ── Clés localStorage ────────────────────────────────────────────────────────
const LOCAL_STORAGE_KEY  = 'teachermada_user_data';
const SESSION_PREFIX     = 'tm_v3_session_';
const SETTINGS_KEY       = 'tm_system_settings';
const SUPPORT_QUOTA_KEY  = 'tm_support_quota';

// ── Cache mémoire pour les settings (évite N+1) ──────────────────────────────
const SETTINGS_TTL_MS = 5 * 60 * 1000; // 5 minutes
let settingsMemoryCache: { data: SystemSettings; expiry: number } | null = null;

// ── Event bus pour les mises à jour utilisateur ──────────────────────────────
type UserUpdateListener = (user: UserProfile) => void;
let userListeners: UserUpdateListener[] = [];

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'error';
type SyncStatusListener = (status: SyncStatus) => void;

const notifyListeners = (user: UserProfile) => {
  userListeners.forEach(listener => listener(user));
};

// ── Écriture localStorage sécurisée (anti-saturation 5MB) ───────────────────
const safeLocalSet = (key: string, value: string): boolean => {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e: any) {
    if (e?.name === 'QuotaExceededError' || e?.code === 22) {
      console.warn('[Storage] Quota dépassé, éviction des vieilles sessions...');
      const sessions = Object.keys(localStorage)
        .filter(k => k.startsWith(SESSION_PREFIX))
        .map(k => {
          try { return { key: k, ts: (JSON.parse(localStorage.getItem(k) || '{}').updatedAt || 0) }; }
          catch { return { key: k, ts: 0 }; }
        })
        .sort((a, b) => a.ts - b.ts);
      sessions.slice(0, 3).forEach(s => localStorage.removeItem(s.key));
      try { localStorage.setItem(key, value); return true; } catch { return false; }
    }
    return false;
  }
};

// ── Mapper DB → UserProfile ──────────────────────────────────────────────────
const mapProfile = (data: any): UserProfile => ({
  id:          data.id,
  username:    data.username || "Utilisateur",
  email:       data.email,
  phoneNumber: data.phone_number || '',
  role:        data.role || 'user',
  credits:     data.credits ?? 0,
  preferences: data.preferences,
  createdAt:   new Date(data.created_at).getTime(),
  updatedAt:   new Date(data.updated_at).getTime(),
  isSuspended: data.is_suspended ?? false,
});

// ── Formater l'email de login (fallback si pas d'email réel) ────────────────
const formatLoginEmail = (input: string) => {
  const trimmed = input.trim();
  if (trimmed.includes('@')) return trimmed;
  const cleanId = trimmed.toLowerCase().replace(/[^a-z0-9._\-+]/g, '');
  return `${cleanId}@teachermada.local`;
};

// ── Profil par défaut lors de la création ────────────────────────────────────
const createDefaultProfilePayload = (id: string, username: string, email: string) => ({
  id,
  username,
  email,
  role:         'user',
  credits:      6,
  preferences:  null,
  is_suspended: false,
  created_at:   new Date().toISOString(),
  updated_at:   new Date().toISOString(),
});

// ── Traduire les erreurs Supabase Auth en messages FR ────────────────────────
const translateAuthError = (errorMessage: string): string => {
  const msg = errorMessage.toLowerCase();
  if (msg.includes('invalid login credentials') || msg.includes('invalid credentials')) {
    return "Identifiant ou mot de passe incorrect.";
  }
  if (msg.includes('email not confirmed')) {
    return "Email non confirmé. Vérifiez votre boîte mail ou contactez l'administrateur.";
  }
  if (msg.includes('user not found')) {
    return "Aucun compte trouvé avec cet identifiant.";
  }
  if (msg.includes('too many requests') || msg.includes('rate limit')) {
    return "Trop de tentatives. Réessayez dans quelques minutes.";
  }
  if (msg.includes('network') || msg.includes('fetch')) {
    return "Erreur réseau. Vérifiez votre connexion internet.";
  }
  return `Erreur de connexion: ${errorMessage}`;
};

// ============================================================================
export const storageService = {

  // ── Subscriptions ──────────────────────────────────────────────────────────

  subscribeToSyncUpdates: (callback: SyncStatusListener) => {
    return syncService.subscribe(callback);
  },

  subscribeToUserUpdates: (callback: UserUpdateListener) => {
    userListeners.push(callback);
    return () => {
      userListeners = userListeners.filter(cb => cb !== callback);
    };
  },

  subscribeToRemoteChanges: (userId: string) => {
    if (!isSupabaseConfigured()) return () => {};

    console.log(`[Realtime] Subscribing to profile changes for ${userId}`);
    const channel = supabase
      .channel(`profile:${userId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` },
        (payload) => {
          if (!payload.new) return;

          const mappedUser  = mapProfile(payload.new);
          const currentUser = storageService.getLocalUser();

          if (currentUser && currentUser.id === userId) {
            // Pas de mise à jour si rien n'a changé
            if (
              currentUser.credits     === mappedUser.credits &&
              currentUser.isSuspended === mappedUser.isSuspended
            ) return;

            const merged: UserProfile = {
              ...currentUser,
              ...mappedUser,
              // Préserver les préférences locales si le serveur n'en a pas
              preferences: (mappedUser.preferences && Object.keys(mappedUser.preferences).length > 0)
                ? mappedUser.preferences
                : currentUser.preferences,
            };

            storageService.saveLocalUser(merged);

            // Notifications temps-réel
            if (mappedUser.credits > currentUser.credits) {
              toast.success(`🎉 +${mappedUser.credits - currentUser.credits} crédits reçus !`);
            } else if (mappedUser.credits < currentUser.credits) {
              toast.info(`💳 Solde mis à jour : ${mappedUser.credits} crédits`);
            }
            if (mappedUser.isSuspended && !currentUser.isSuspended) {
              toast.error("⚠️ Votre compte a été suspendu. Contactez l'administrateur.");
            }
          } else {
            storageService.saveLocalUser(mappedUser);
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Realtime] ✅ Connecté au canal profil');
        }
      });

    return () => {
      console.log(`[Realtime] Unsubscribing for ${userId}`);
      supabase.removeChannel(channel);
    };
  },

  // ── AUTH ───────────────────────────────────────────────────────────────────

  resetPassword: async (identifier: string): Promise<{ success: boolean; error?: string }> => {
    if (!isSupabaseConfigured()) return { success: false, error: "Supabase non configuré." };
    try {
      const email = formatLoginEmail(identifier);
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) return { success: false, error: error.message };
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  },

  login: async (usernameOrEmail: string, password: string): Promise<{ success: boolean; user?: UserProfile; error?: string }> => {
    if (!isSupabaseConfigured()) {
      return { success: false, error: "Supabase non configuré (Mode hors ligne)." };
    }

    let email = usernameOrEmail.trim();

    // ── Résolution de l'email si l'identifiant n'est pas un email ────────────
    if (!email.includes('@')) {
      try {
        // 1. Utiliser le RPC SECURITY DEFINER (bypass RLS, fiable)
        const { data: resolvedEmail, error: rpcError } = await supabase
          .rpc('get_email_by_identifier', { p_identifier: email });

        if (!rpcError && resolvedEmail) {
          email = resolvedEmail;
          console.log('[Login] Email résolu via RPC:', email);
        } else {
          // 2. Fallback local (même logique que la registration)
          email = formatLoginEmail(usernameOrEmail);
          console.warn('[Login] RPC échoué, fallback email:', email, rpcError?.message);
        }
      } catch (e) {
        email = formatLoginEmail(usernameOrEmail);
        console.warn('[Login] Exception lookup, fallback:', email);
      }
    }

    try {
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        console.error('[Login] Auth error:', authError.message);
        return { success: false, error: translateAuthError(authError.message) };
      }

      if (!authData?.user) {
        return { success: false, error: "Erreur de connexion inattendue." };
      }

      // ── Charger le profil ──────────────────────────────────────────────────
      let user = await storageService.getUserById(authData.user.id);

      if (!user) {
        // Attendre un court instant (trigger Supabase peut être en cours)
        await new Promise(r => setTimeout(r, 800));
        user = await storageService.getUserById(authData.user.id);
      }

      if (!user) {
        // Auto-création du profil si manquant
        console.warn('[Login] Profil introuvable, création automatique...');
        const usernameFallback = authData.user.user_metadata?.username || email.split('@')[0];
        const payload = createDefaultProfilePayload(authData.user.id, usernameFallback, email);
        const { error: insertError } = await supabase.from('profiles').insert([payload]);
        if (insertError) {
          console.error('[Login] Auto-création profil échouée:', insertError);
          return { success: false, error: "Profil introuvable. Contactez l'administrateur." };
        }
        user = mapProfile(payload);
      }

      if (user.isSuspended) {
        await supabase.auth.signOut();
        return { success: false, error: "Compte suspendu. Contactez l'administrateur." };
      }

      storageService.saveLocalUser(user);
      return { success: true, user };

    } catch (e: any) {
      console.error('[Login] Exception:', e);
      return { success: false, error: translateAuthError(e.message) };
    }
  },

  register: async (
    username: string,
    password?: string,
    email?: string,
    phoneNumber?: string
  ): Promise<{ success: boolean; user?: UserProfile; error?: string }> => {
    if (!isSupabaseConfigured()) return { success: false, error: "Supabase non configuré." };

    const DEVICE_ACCOUNT_LIMIT = 3;
    const currentCount = parseInt(localStorage.getItem('tm_device_accounts_count') || '0', 10);
    if (currentCount >= DEVICE_ACCOUNT_LIMIT) {
      return { success: false, error: "Limite atteinte sur cet appareil (max 3 comptes)." };
    }
    if (!password) return { success: false, error: "Mot de passe requis." };
    if (!username) return { success: false, error: "Nom d'utilisateur requis." };

    let finalEmail = email?.trim() || "";
    if (!finalEmail) finalEmail = formatLoginEmail(username);

    try {
      // Vérifier si le username est déjà pris
      const { data: existing } = await supabase
        .from('profiles')
        .select('id')
        .eq('username', username.trim())
        .maybeSingle();

      if (existing) {
        return { success: false, error: "Ce nom d'utilisateur est déjà utilisé." };
      }

      const { data: authData, error: authError } = await supabase.auth.signUp({
        email:    finalEmail,
        password: password,
        options:  {
          data: {
            username:     username.trim(),
            phone_number: phoneNumber?.trim() || "",
          }
        },
      });

      if (authError) return { success: false, error: authError.message };
      if (!authData.user) return { success: false, error: "Erreur lors de la création du compte." };

      const payload = createDefaultProfilePayload(authData.user.id, username.trim(), finalEmail);
      if (phoneNumber) (payload as any).phone_number = phoneNumber.trim();

      const { error: insertError } = await supabase.from('profiles').insert([payload]);
      if (insertError && insertError.code !== '23505') {
        console.warn('[Register] Erreur insertion profil (peut être ignorée si trigger actif):', insertError);
      }

      const newUser = mapProfile(payload);
      storageService.saveLocalUser(newUser);
      localStorage.setItem('tm_device_accounts_count', (currentCount + 1).toString());

      return { success: true, user: newUser };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  },

  logout: async () => {
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch (e) {
      console.warn('[Logout] signOut error (réseau):', e);
    }
    // ✅ FIX: Ne pas supprimer les sessions (historique préservé)
    // On supprime SEULEMENT les données d'authentification
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    localStorage.removeItem('tm_v3_current_user_id');
    // NE PAS supprimer les sessions tm_v3_session_* → historique conservé
  },

  // ── PROFILS ────────────────────────────────────────────────────────────────

  getCurrentUser: async (): Promise<UserProfile | null> => {
    const localUser = storageService.getLocalUser();
    if (!isSupabaseConfigured()) return localUser;

    try {
      const { data: { session }, error } = await supabase.auth.getSession();

      if (error) {
        if (error.message?.includes("Invalid Refresh Token") || error.message?.includes("Refresh Token Not Found")) {
          console.warn('[getCurrentUser] Session expirée, déconnexion...');
          await storageService.logout();
          return null;
        }
        throw error;
      }

      if (session?.user) {
        let dbUser = await storageService.getUserById(session.user.id);

        if (!dbUser) {
          const email = session.user.email || '';
          const usernameFallback = session.user.user_metadata?.username || email.split('@')[0] || 'User';
          const payload = createDefaultProfilePayload(session.user.id, usernameFallback, email);
          const { error: insertError } = await supabase.from('profiles').insert([payload]);
          if (!insertError) dbUser = mapProfile(payload);
        }

        if (dbUser) {
          // Restaurer les préférences locales si le serveur n'en a pas
          if (!dbUser.preferences && localUser?.preferences && localUser.id === dbUser.id) {
            dbUser.preferences = localUser.preferences;
            storageService.saveUserProfile(dbUser);
          }
          storageService.saveLocalUser(dbUser);
          return dbUser;
        }
      }
    } catch (e) {
      console.warn('[getCurrentUser] Supabase hors ligne, fallback local.');
    }

    return localUser;
  },

  getLocalUser: (): UserProfile | null => {
    try {
      const data = localStorage.getItem(LOCAL_STORAGE_KEY);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  },

  saveLocalUser: (user: UserProfile) => {
    safeLocalSet(LOCAL_STORAGE_KEY, JSON.stringify(user));
    notifyListeners(user);
  },

  getUserById: async (id: string): Promise<UserProfile | null> => {
    if (!isSupabaseConfigured()) return null;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', id)
        .single();
      if (error || !data) return null;
      return mapProfile(data);
    } catch {
      return null;
    }
  },

  saveUserProfile: async (user: UserProfile) => {
    storageService.saveLocalUser(user);
    if (isSupabaseConfigured()) {
      const updates = {
        id:           user.id,
        username:     user.username,
        preferences:  user.preferences,
        updated_at:   new Date().toISOString(),
      };
      await syncService.addToQueue('UPDATE_PROFILE', updates, `profile_${user.id}`);
    }
  },

  updateAccountInfo: async (
    userId: string,
    updates: {
      username?: string;
      email?: string;
      phoneNumber?: string;
      newPassword?: string;
      currentPassword?: string;
    }
  ): Promise<{ success: boolean; error?: string }> => {
    if (!isSupabaseConfigured()) return { success: false, error: "Supabase non configuré." };

    try {
      // Re-authentification si changement de mot de passe
      if (updates.newPassword && updates.currentPassword) {
        const { data: sessionData } = await supabase.auth.getSession();
        const currentEmail = sessionData?.session?.user?.email;
        if (!currentEmail) return { success: false, error: "Session expirée. Reconnectez-vous." };

        const { error: reAuthError } = await supabase.auth.signInWithPassword({
          email:    currentEmail,
          password: updates.currentPassword,
        });
        if (reAuthError) return { success: false, error: "Mot de passe actuel incorrect." };

        const { error: pwError } = await supabase.auth.updateUser({ password: updates.newPassword });
        if (pwError) return { success: false, error: pwError.message };
      }

      if (updates.email) {
        const { error: emailError } = await supabase.auth.updateUser({ email: updates.email });
        if (emailError) return { success: false, error: emailError.message };
      }

      const profileUpdates: any = { updated_at: new Date().toISOString() };
      if (updates.username)                    profileUpdates.username     = updates.username.trim();
      if (updates.email)                       profileUpdates.email        = updates.email.trim();
      if (updates.phoneNumber !== undefined)   profileUpdates.phone_number = updates.phoneNumber.trim();

      if (Object.keys(profileUpdates).length > 1) {
        const { error: dbError } = await supabase.from('profiles').update(profileUpdates).eq('id', userId);
        if (dbError) return { success: false, error: dbError.message };
      }

      // Mise à jour locale
      const local = storageService.getLocalUser();
      if (local && local.id === userId) {
        const updated: any = { ...local };
        if (updates.username)                  updated.username    = updates.username.trim();
        if (updates.email)                     updated.email       = updates.email.trim();
        if (updates.phoneNumber !== undefined) updated.phoneNumber = updates.phoneNumber.trim();
        storageService.saveLocalUser(updated);
      }

      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  },

  getAllUsers: async (): Promise<UserProfile[]> => {
    if (!isSupabaseConfigured()) return [];
    try {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });
      return data ? data.map(mapProfile) : [];
    } catch {
      return [];
    }
  },

  // ── CRÉDITS ────────────────────────────────────────────────────────────────

  canRequest: async (userId: string, minCredits: number = 1): Promise<boolean> => {
    const localUser = storageService.getLocalUser();
    if (!localUser || localUser.id !== userId) return false;
    if (localUser.role === 'admin') return true;
    if (localUser.isSuspended) return false;
    return localUser.credits >= minCredits;
  },

  consumeCredit: async (userId: string): Promise<boolean> => {
    return storageService.deductCredits(userId, 1);
  },

  /**
   * ✅ FIX CRITIQUE: gère la réponse JSONB du RPC (plus INTEGER)
   */
  deductCredits: async (userId: string, amount: number): Promise<boolean> => {
    const local = storageService.getLocalUser();
    if (!local || local.id !== userId) {
      console.warn('[deductCredits] Utilisateur non trouvé localement');
      return false;
    }

    // Admins non débités
    if (local.role === 'admin') return true;

    // Mode hors ligne
    if (!isSupabaseConfigured()) {
      if (local.credits < amount) return false;
      storageService.saveLocalUser({ ...local, credits: local.credits - amount });
      return true;
    }

    try {
      const { data, error } = await supabase.rpc('consume_credits', {
        p_user_id: userId,
        p_amount:  amount,
      });

      if (error) {
        console.error('[deductCredits] Erreur RPC:', error.message);
        // Fallback local si crédits suffisants
        if (local.credits >= amount) {
          storageService.saveLocalUser({ ...local, credits: local.credits - amount });
          return true;
        }
        return false;
      }

      // ✅ La réponse est maintenant un JSONB object
      if (!data || !data.success) {
        console.warn('[deductCredits] Échec RPC:', data?.reason, '| Solde actuel:', data?.current_balance);
        // Synchroniser le solde local si disponible
        if (typeof data?.current_balance === 'number') {
          storageService.saveLocalUser({ ...local, credits: data.current_balance });
        }
        return false;
      }

      // Mettre à jour le solde local
      storageService.saveLocalUser({ ...local, credits: data.new_balance });
      console.log(`[deductCredits] ✅ -${amount} crédits | Nouveau solde: ${data.new_balance}`);
      return true;

    } catch (e: any) {
      console.error('[deductCredits] Exception:', e.message);
      // Fallback local
      if (local.credits >= amount) {
        storageService.saveLocalUser({ ...local, credits: local.credits - amount });
        return true;
      }
      return false;
    }
  },

  checkCredits: async (userId: string): Promise<number> => {
    const local = storageService.getLocalUser();
    if (!local || local.id !== userId) return 0;
    if (local.role === 'admin') return 999999;
    if (!isSupabaseConfigured()) return local.credits || 0;

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('credits')
        .eq('id', userId)
        .single();

      if (error || !data) return local.credits || 0;

      if (data.credits !== local.credits) {
        storageService.saveLocalUser({ ...local, credits: data.credits });
      }
      return data.credits || 0;
    } catch {
      return local.credits || 0;
    }
  },

  /**
   * ✅ FIX CRITIQUE: gère la réponse JSONB de admin_add_credits
   */
  addCredits: async (userId: string, amount: number): Promise<boolean> => {
    if (!isSupabaseConfigured()) return false;

    try {
      const { data, error } = await supabase.rpc('admin_add_credits', {
        p_target_user: userId,
        p_amount:      amount,
      });

      if (error) {
        console.error('[addCredits] Erreur RPC:', error.message);
        return false;
      }

      if (!data?.success) {
        console.error('[addCredits] Échec:', data?.reason);
        return false;
      }

      console.log(`[addCredits] ✅ +${amount} crédits | Nouveau solde: ${data.new_balance}`);

      // Mettre à jour localement si c'est l'utilisateur connecté
      const local = storageService.getLocalUser();
      if (local && local.id === userId) {
        storageService.saveLocalUser({ ...local, credits: data.new_balance });
      }

      return true;
    } catch (e: any) {
      console.error('[addCredits] Exception:', e.message);
      return false;
    }
  },

  /**
   * ✅ NOUVEAU: Retrait de crédits par l'admin (bouton -)
   */
  adminDeductCredits: async (userId: string, amount: number): Promise<boolean> => {
    if (!isSupabaseConfigured()) return false;

    try {
      const { data, error } = await supabase.rpc('admin_deduct_credits', {
        p_target_user: userId,
        p_amount:      amount,
      });

      if (error) {
        console.error('[adminDeductCredits] Erreur RPC:', error.message);
        return false;
      }

      if (!data?.success) {
        console.error('[adminDeductCredits] Échec:', data?.reason);
        return false;
      }

      console.log(`[adminDeductCredits] ✅ -${amount} crédits | Nouveau solde: ${data.new_balance}`);
      return true;
    } catch (e: any) {
      console.error('[adminDeductCredits] Exception:', e.message);
      return false;
    }
  },

  // ── ADMIN: Gestion des utilisateurs ────────────────────────────────────────

  /**
   * ✅ NOUVEAU: Suppression complète d'un utilisateur
   */
  adminDeleteUser: async (userId: string): Promise<{ success: boolean; error?: string }> => {
    if (!isSupabaseConfigured()) return { success: false, error: "Supabase non configuré." };

    try {
      const { data, error } = await supabase.rpc('admin_delete_user', {
        p_target_user: userId,
      });

      if (error) return { success: false, error: error.message };
      if (!data?.success) return { success: false, error: data?.reason || "Erreur inconnue." };

      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  },

  /**
   * ✅ NOUVEAU: Suspension/Activation via RPC sécurisé
   */
  adminToggleSuspend: async (userId: string, suspend: boolean): Promise<{ success: boolean; error?: string }> => {
    if (!isSupabaseConfigured()) return { success: false, error: "Supabase non configuré." };

    try {
      const { data, error } = await supabase.rpc('admin_suspend_user', {
        p_target_user: userId,
        p_suspend:     suspend,
      });

      if (error) return { success: false, error: error.message };
      if (!data?.success) return { success: false, error: "Impossible de modifier le statut." };

      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  },

  /**
   * ✅ NOUVEAU: Réinitialisation du mot de passe par admin (envoi d'email)
   */
  adminResetUserPassword: async (userEmail: string): Promise<{ success: boolean; error?: string }> => {
    if (!isSupabaseConfigured()) return { success: false, error: "Supabase non configuré." };

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(userEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) return { success: false, error: error.message };
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  },

  /**
   * ✅ NOUVEAU: Modifier les infos d'un utilisateur (admin)
   */
  adminUpdateUser: async (
    userId: string,
    updates: { username?: string; email?: string; phoneNumber?: string }
  ): Promise<{ success: boolean; error?: string }> => {
    if (!isSupabaseConfigured()) return { success: false, error: "Supabase non configuré." };

    try {
      const { data, error } = await supabase.rpc('admin_update_user', {
        p_target_user: userId,
        p_username:    updates.username || null,
        p_email:       updates.email || null,
        p_phone:       updates.phoneNumber || null,
      });

      if (error) return { success: false, error: error.message };
      if (!data?.success) return { success: false, error: "Mise à jour échouée." };

      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  },

  // ── SESSIONS (chat history) ────────────────────────────────────────────────

  getSessionKey: (userId: string, prefs: UserPreferences) => {
    const cleanMode = prefs.mode.replace(/\s/g, '_');
    const cleanLang = prefs.targetLanguage.split(' ')[0];
    return `${SESSION_PREFIX}${userId}_${cleanLang}_${prefs.level}_${cleanMode}`;
  },

  getOrCreateSession: async (userId: string, prefs: UserPreferences): Promise<LearningSession> => {
    const key      = storageService.getSessionKey(userId, prefs);
    const cleanLang = prefs.targetLanguage.split(' ')[0];

    // 1. Charger le local immédiatement (offline-first)
    let localSession: LearningSession | null = null;
    try {
      const localData = localStorage.getItem(key);
      localSession = localData ? JSON.parse(localData) : null;
    } catch {
      localSession = null;
    }

    // 2. Sync Supabase en arrière-plan (non-bloquant)
    if (isSupabaseConfigured()) {
      (async () => {
        try {
          const { data, error } = await supabase
            .from('learning_sessions')
            .select('*')
            .eq('id', key)
            .single();

          if (error || !data) return;

          const remoteMessages: any[] = data.messages || [];
          const remoteUpdatedAt = new Date(data.updated_at).getTime();
          const localUpdatedAt  = localSession?.updatedAt || 0;
          const localMsgCount   = localSession?.messages?.length || 0;

          if (remoteUpdatedAt > localUpdatedAt && remoteMessages.length >= localMsgCount) {
            const remoteSession: LearningSession = {
              id:        data.id,
              userId:    data.user_id,
              type:      (data.mode || 'lesson') as any,
              language:  data.target_language || cleanLang,
              level:     data.level,
              messages:  remoteMessages,
              updatedAt: remoteUpdatedAt,
            };
            try { localStorage.setItem(key, JSON.stringify(remoteSession)); } catch { /* quota */ }
            window.dispatchEvent(new CustomEvent('tm_session_updated', { detail: remoteSession }));
          }
        } catch (e) {
          console.warn('[Session] Sync arrière-plan échouée:', e);
        }
      })();
    }

    // 3. Retourner la session locale si elle existe
    if (localSession) return localSession;

    // 4. Créer une nouvelle session
    const newSession: LearningSession = {
      id:        key,
      userId,
      type:      'lesson',
      language:  cleanLang,
      level:     prefs.level,
      messages:  [],
      updatedAt: Date.now(),
    };
    await storageService.saveSession(newSession);
    return newSession;
  },

  saveSession: async (session: LearningSession) => {
    session.updatedAt = Date.now();

    // Limiter à 150 messages (garder le premier + les 149 derniers)
    if (session.messages.length > 150) {
      session.messages = [session.messages[0], ...session.messages.slice(-149)];
    }

    // Sauvegarde locale immédiate
    safeLocalSet(session.id, JSON.stringify(session));

    if (!isSupabaseConfigured()) return;

    const expiresAt = new Date(session.updatedAt + 30 * 24 * 60 * 60 * 1000).toISOString();
    const payload = {
      id:              session.id,
      user_id:         session.userId,
      target_language: session.language,
      level:           session.level,
      mode:            session.type || 'lesson',
      messages:        session.messages,
      updated_at:      new Date(session.updatedAt).toISOString(),
      expires_at:      expiresAt,
    };

    if (navigator.onLine) {
      try {
        const { error } = await supabase
          .from('learning_sessions')
          .upsert(payload, { onConflict: 'id' });
        if (error) {
          syncService.addToQueue('UPSERT_SESSION', payload, `session_${session.id}`);
        }
      } catch {
        syncService.addToQueue('UPSERT_SESSION', payload, `session_${session.id}`);
      }
    } else {
      syncService.addToQueue('UPSERT_SESSION', payload, `session_${session.id}`);
    }
  },

  clearSession: (userId: string) => {
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith(`${SESSION_PREFIX}${userId}`)) {
        localStorage.removeItem(key);
      }
    });
  },

  getChatHistory: (_lang: string): any[] => [],

  // ── EXAMS & CERTIFICATES ───────────────────────────────────────────────────

  saveExamResult: async (result: ExamResult) => {
    try {
      safeLocalSet(`tm_exam_${result.id}`, JSON.stringify(result));
      if (!isSupabaseConfigured()) return;
      const payload = {
        id:              result.id,
        user_id:         result.userId,
        language:        result.language,
        level:           result.level,
        score:           result.score,
        total_questions: result.totalQuestions,
        passed:          result.passed,
        details:         result.details,
        created_at:      new Date(result.date).toISOString(),
      };
      await syncService.addToQueue('INSERT_EXAM', payload);
    } catch (e) {
      console.warn('[saveExamResult] Erreur:', e);
    }
  },

  getExamResults: async (userId: string): Promise<ExamResult[]> => {
    let results: ExamResult[] = [];

    if (isSupabaseConfigured()) {
      try {
        const { data } = await supabase
          .from('exam_results')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false });

        if (data) {
          results = data.map(d => ({
            id:             d.id,
            userId:         d.user_id,
            language:       d.language,
            level:          d.level,
            score:          d.score,
            totalQuestions: d.total_questions,
            passed:         d.passed,
            date:           new Date(d.created_at).getTime(),
            details:        d.details,
          }));
        }
      } catch (e) {
        console.warn('[getExamResults] Supabase failed, fallback local:', e);
      }
    }

    if (results.length === 0) {
      const keys = Object.keys(localStorage).filter(k => k.startsWith('tm_exam_'));
      const localResults = keys
        .map(k => { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch { return {}; } })
        .filter((r: ExamResult) => r.userId === userId);
      localResults.sort((a: ExamResult, b: ExamResult) => b.date - a.date);
      if (localResults.length > 0) results = localResults;
    }

    return results;
  },

  saveCertificate: async (cert: Certificate) => {
    try {
      safeLocalSet(`tm_cert_${cert.id}`, JSON.stringify(cert));
      if (!isSupabaseConfigured()) return;
      const payload = {
        id:               cert.id,
        user_id:          cert.userId,
        user_name:        cert.userName,
        user_full_name:   cert.userFullName,
        language:         cert.language,
        level:            cert.level,
        exam_id:          cert.examId,
        issue_date:       new Date(cert.issueDate).toISOString(),
        validation_hash:  cert.validationHash,
        qr_code_data:     cert.qrCodeData,
        score:            cert.score,
        global_score:     cert.globalScore,
        skill_scores:     cert.skillScores,
      };
      await syncService.addToQueue('INSERT_CERT', payload);
    } catch (e) {
      console.warn('[saveCertificate] Erreur:', e);
    }
  },

  getCertificates: async (userId: string): Promise<Certificate[]> => {
    if (!isSupabaseConfigured()) {
      const keys = Object.keys(localStorage).filter(k => k.startsWith('tm_cert_'));
      return keys
        .map(k => { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch { return null; } })
        .filter(c => c && c.userId === userId);
    }
    try {
      const { data } = await supabase
        .from('certificates')
        .select('*')
        .eq('user_id', userId)
        .order('issue_date', { ascending: false });
      return data ? data.map((d: any) => ({
        id:             d.id,
        userId:         d.user_id,
        userName:       d.user_name,
        userFullName:   d.user_full_name,
        language:       d.language,
        level:          d.level,
        examId:         d.exam_id,
        issueDate:      new Date(d.issue_date).getTime(),
        validationHash: d.validation_hash,
        qrCodeData:     d.qr_code_data,
        score:          d.score,
        globalScore:    d.global_score,
        skillScores:    d.skill_scores,
      })) : [];
    } catch {
      return [];
    }
  },

  getCertificateById: async (certId: string): Promise<Certificate | null> => {
    const local = localStorage.getItem(`tm_cert_${certId}`);
    if (local) { try { return JSON.parse(local); } catch { /* ignoré */ } }

    if (isSupabaseConfigured()) {
      try {
        const { data } = await supabase.from('certificates').select('*').eq('id', certId).single();
        if (data) return {
          id:             data.id,
          userId:         data.user_id,
          userName:       data.user_name,
          userFullName:   data.user_full_name,
          language:       data.language,
          level:          data.level,
          examId:         data.exam_id,
          issueDate:      new Date(data.issue_date).getTime(),
          validationHash: data.validation_hash,
          qrCodeData:     data.qr_code_data,
          score:          data.score,
          globalScore:    data.global_score,
          skillScores:    data.skill_scores,
        };
      } catch (e) {
        console.warn('[getCertificateById] Erreur:', e);
      }
    }
    return null;
  },

  // ── NOTIFICATIONS ──────────────────────────────────────────────────────────

  getNotifications: async (userId: string): Promise<SmartNotification[]> => {
    if (isSupabaseConfigured()) {
      try {
        const { data } = await supabase
          .from('notifications')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(50);

        if (data) {
          const mapped = data.map(n => ({
            id:        n.id,
            userId:    n.user_id,
            type:      n.type,
            title:     n.title,
            message:   n.message,
            read:      n.read,
            createdAt: new Date(n.created_at).getTime(),
            data:      n.data,
          }));
          safeLocalSet(`tm_notifications_${userId}`, JSON.stringify(mapped));
          return mapped;
        }
      } catch { /* Fallback local */ }
    }

    const local = localStorage.getItem(`tm_notifications_${userId}`);
    return local ? JSON.parse(local) : [];
  },

  getUnreadCount: async (userId: string): Promise<number> => {
    const notifs = await storageService.getNotifications(userId);
    return notifs.filter(n => !n.read).length;
  },

  createNotification: async (n: Omit<SmartNotification, 'id' | 'createdAt' | 'read'>) => {
    const newNotif: SmartNotification = {
      ...n,
      id:        crypto.randomUUID(),
      createdAt: Date.now(),
      read:      false,
    };

    const localKey = `tm_notifications_${n.userId}`;
    const local = JSON.parse(localStorage.getItem(localKey) || "[]");
    safeLocalSet(localKey, JSON.stringify([newNotif, ...local].slice(0, 50)));

    if (isSupabaseConfigured()) {
      await syncService.addToQueue('INSERT_NOTIF', {
        id:         newNotif.id,
        user_id:    newNotif.userId,
        type:       newNotif.type,
        title:      newNotif.title,
        message:    newNotif.message,
        read:       false,
        data:       newNotif.data,
        created_at: new Date().toISOString(),
      });
    }

    return newNotif;
  },

  markNotificationRead: async (userId: string, notifId: string) => {
    const localKey = `tm_notifications_${userId}`;
    const local = JSON.parse(localStorage.getItem(localKey) || "[]");
    safeLocalSet(localKey, JSON.stringify(
      local.map((n: SmartNotification) => n.id === notifId ? { ...n, read: true } : n)
    ));
    if (isSupabaseConfigured()) {
      await syncService.addToQueue('MARK_NOTIF_READ', { id: notifId });
    }
  },

  markAllNotificationsRead: async (userId: string) => {
    const localKey = `tm_notifications_${userId}`;
    const local = JSON.parse(localStorage.getItem(localKey) || "[]");
    safeLocalSet(localKey, JSON.stringify(local.map((n: SmartNotification) => ({ ...n, read: true }))));
    if (isSupabaseConfigured()) {
      await syncService.addToQueue('MARK_ALL_NOTIF_READ', { userId });
    }
  },

  deleteNotification: async (userId: string, notifId: string) => {
    const localKey = `tm_notifications_${userId}`;
    const local = JSON.parse(localStorage.getItem(localKey) || "[]");
    safeLocalSet(localKey, JSON.stringify(
      local.filter((n: SmartNotification) => n.id !== notifId)
    ));
    if (isSupabaseConfigured()) {
      await syncService.addToQueue('DELETE_NOTIF', { id: notifId });
    }
  },

  // ── ADMIN REQUESTS ────────────────────────────────────────────────────────

  getAdminRequests: async (): Promise<AdminRequest[]> => {
    if (!isSupabaseConfigured()) return [];
    try {
      const { data } = await supabase
        .from('admin_requests')
        .select('*')
        .order('created_at', { ascending: false });
      return data ? data.map(d => ({
        id:        d.id,
        userId:    d.user_id,
        username:  d.username,
        type:      d.type,
        amount:    d.amount,
        message:   d.message,
        status:    d.status,
        createdAt: d.created_at ? new Date(d.created_at).getTime() : Date.now(),
      })) : [];
    } catch { return []; }
  },

  cleanupOldRequests: async () => {
    try {
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      await supabase.from('admin_requests').delete().lt('created_at', oneWeekAgo);
    } catch { /* ignoré */ }
  },

  sendAdminRequest: async (
    userId: string,
    username: string,
    type: 'credit' | 'password_reset' | 'message',
    amount?: number,
    message?: string,
    contact?: string
  ): Promise<{ status: 'pending' | 'approved' }> => {
    if (!isSupabaseConfigured()) return { status: 'pending' };
    try {
      const fullMessage = contact ? `${message} [Contact: ${contact}]` : message;
      await supabase.from('admin_requests').insert([{
        user_id: userId, username, type, amount, message: fullMessage, status: 'pending'
      }]);
      return { status: 'pending' };
    } catch {
      return { status: 'pending' };
    }
  },

  resolveRequest: async (reqId: string, status: 'approved' | 'rejected') => {
    try {
      if (status === 'approved') {
        const { data: req } = await supabase.from('admin_requests').select('*').eq('id', reqId).single();
        if (req?.type === 'credit' && req.amount) {
          await storageService.addCredits(req.user_id, req.amount);
          await storageService.createNotification({
            userId:  req.user_id,
            type:    'admin',
            title:   'Demande Approuvée',
            message: `Votre demande de ${req.amount} crédits a été validée.`,
          });
        }
      } else {
        const { data: req } = await supabase.from('admin_requests').select('*').eq('id', reqId).single();
        if (req) {
          await storageService.createNotification({
            userId:  req.user_id,
            type:    'admin',
            title:   'Demande Refusée',
            message: `Votre demande a été refusée par l'administrateur.`,
          });
        }
      }
      await supabase.from('admin_requests').update({ status }).eq('id', reqId);
    } catch (e) {
      console.warn('[resolveRequest] Erreur:', e);
    }
  },

  // ── SYSTEM SETTINGS ────────────────────────────────────────────────────────

  loadSystemSettings: async (): Promise<SystemSettings> => {
    const now = Date.now();
    if (settingsMemoryCache && now < settingsMemoryCache.expiry) return settingsMemoryCache.data;

    const localRaw = localStorage.getItem(SETTINGS_KEY);
    if (localRaw) {
      try {
        const localParsed = JSON.parse(localRaw);
        if (localParsed._cachedAt && now - localParsed._cachedAt < SETTINGS_TTL_MS) {
          settingsMemoryCache = { data: localParsed, expiry: localParsed._cachedAt + SETTINGS_TTL_MS };
          return localParsed;
        }
      } catch { /* ignoré */ }
    }

    if (!isSupabaseConfigured()) return storageService.getSystemSettings();

    try {
      const { data, error } = await supabase.from('system_settings').select('*').single();
      if (!error && data) {
        let normalizedCoupons: CouponCode[] = [];
        const rawCoupons = data.valid_coupons ?? data.valid_transaction_refs ?? [];
        if (Array.isArray(rawCoupons)) {
          normalizedCoupons = rawCoupons
            .map((r: any) => typeof r === 'string' ? JSON.parse(r) : r)
            .filter((c: any) => c?.code);
        }

        const settings: SystemSettings = {
          creditPrice:         data.credit_price || 50,
          validTransactionRefs: normalizedCoupons,
          adminContact:        data.admin_contact || { telma: "0349310268", airtel: "0333878420", orange: "0326979017" },
          updatedAt:           now,
        };

        const toCache = { ...settings, _cachedAt: now };
        safeLocalSet(SETTINGS_KEY, JSON.stringify(toCache));
        settingsMemoryCache = { data: settings, expiry: now + SETTINGS_TTL_MS };
        return settings;
      }
    } catch { /* ignoré */ }

    return storageService.getSystemSettings();
  },

  getSystemSettings: (): SystemSettings => {
    const local = localStorage.getItem(SETTINGS_KEY);
    if (local) { try { return JSON.parse(local); } catch { /* ignoré */ } }
    return {
      creditPrice:         50,
      validTransactionRefs: [],
      adminContact:        { telma: "0349310268", airtel: "0333878420", orange: "0326979017" },
      updatedAt:           Date.now(),
    };
  },

  updateSystemSettings: async (settings: SystemSettings): Promise<boolean> => {
    settingsMemoryCache = null;
    safeLocalSet(SETTINGS_KEY, JSON.stringify(settings));
    if (!isSupabaseConfigured()) return true;
    try {
      const { error } = await supabase.from('system_settings').upsert({
        id:           1,
        credit_price: settings.creditPrice,
        valid_coupons: settings.validTransactionRefs,
        admin_contact: settings.adminContact,
      });
      return !error;
    } catch {
      return false;
    }
  },

  // ── MISC ────────────────────────────────────────────────────────────────────

  canUseSupportAgent: (): boolean => {
    const today = new Date().toDateString();
    const raw = localStorage.getItem(SUPPORT_QUOTA_KEY);
    let data = raw ? JSON.parse(raw) : { date: today, count: 0 };
    if (data.date !== today) data = { date: today, count: 0 };
    return data.count < 100;
  },

  incrementSupportUsage: () => {
    const today = new Date().toDateString();
    const raw = localStorage.getItem(SUPPORT_QUOTA_KEY);
    let data = raw ? JSON.parse(raw) : { date: today, count: 0 };
    if (data.date !== today) data = { date: today, count: 0 };
    data.count++;
    safeLocalSet(SUPPORT_QUOTA_KEY, JSON.stringify(data));
  },

  redeemCode: async (userId: string, inputCode: string): Promise<{ success: boolean; amount?: number; message?: string }> => {
    try {
      const code = inputCode.trim().toUpperCase();
      const settings = await storageService.loadSystemSettings();
      const validRefs = settings.validTransactionRefs || [];
      const couponIndex = validRefs.findIndex(c => c.code.toUpperCase() === code);

      if (couponIndex !== -1) {
        const coupon = validRefs[couponIndex];
        const amountToAdd = Number(coupon.amount) || 0;
        const creditAdded = await storageService.addCredits(userId, amountToAdd);
        if (!creditAdded) return { success: false, message: "Erreur technique lors de l'ajout des crédits." };

        await storageService.createNotification({
          userId,
          type:    'credit',
          title:   'Crédits Reçus',
          message: `Vous avez reçu ${amountToAdd} crédits via le code ${code}.`,
        });

        const newRefs = validRefs.filter((_, i) => i !== couponIndex);
        await storageService.updateSystemSettings({ ...settings, validTransactionRefs: newRefs });
        return { success: true, amount: amountToAdd };
      }
      return { success: false, message: "Code invalide ou déjà utilisé." };
    } catch {
      return { success: false, message: "Erreur technique." };
    }
  },

  getUserWeaknesses: async (userId: string): Promise<UserWeakness[]> => {
    if (!isSupabaseConfigured()) return [];
    const { data, error } = await supabase
      .from('user_weakness')
      .select('*')
      .eq('user_id', userId)
      .order('error_count', { ascending: false })
      .limit(10);

    if (error) return [];
    return data.map((w: any) => ({
      id:         w.id,
      userId:     w.user_id,
      category:   w.category,
      tag:        w.tag,
      errorCount: w.error_count,
      lastSeen:   new Date(w.last_seen).getTime(),
    }));
  },

  saveUserWeakness: async (userId: string, category: string, tag: string): Promise<void> => {
    if (!isSupabaseConfigured()) return;
    try {
      await supabase.from('user_weakness').upsert(
        { user_id: userId, category, tag, error_count: 1, last_seen: new Date().toISOString() },
        { onConflict: 'user_id,category,tag', ignoreDuplicates: false }
      );
    } catch (e) {
      console.warn('[saveUserWeakness] Erreur non-critique:', e);
    }
  },

  deductCreditOrUsage: async (userId: string) => {
    const success = await storageService.consumeCredit(userId);
    if (success) return storageService.getLocalUser();
    return null;
  },

  canPerformRequest: async (userId: string) => {
    const allowed = await storageService.canRequest(userId);
    return { allowed };
  },

  exportData: async (user: UserProfile) => {
    const blob = new Blob([JSON.stringify(user, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `teachermada_${user.username}_backup.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  importData: async (file: File, currentUserId: string): Promise<boolean> => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (data.username) {
        const { error } = await supabase
          .from('profiles')
          .update({ username: data.username, preferences: data.preferences })
          .eq('id', currentUserId);
        return !error;
      }
    } catch { /* ignoré */ }
    return false;
  },
};
