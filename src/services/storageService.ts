/**
 * @file storageService.ts
 * @description Couche d'abstraction données (Offline-First + Supabase sync).
 *
 * CORRECTIONS AUDIT :
 * - P1 : deductCredits() → RPC atomique consume_credits_safe (plus de race condition)
 * - P3 : saveSession() → utilise lsManager.safeSetJson (anti-quota)
 * - Cache TTL 5min pour loadSystemSettings() (anti N+1)
 * - subscribeToRealtime() → mise à jour instantanée des crédits/notifications
 * - Toutes les écritures localStorage passent par lsManager.safeSetJson
 *
 * TeacherMada v1.1
 */

import { supabase, isSupabaseConfigured } from '../lib/supabase';
import {
  UserProfile, UserPreferences, LearningSession, AdminRequest,
  SystemSettings, CouponCode, ExamResult, Certificate, SmartNotification, UserWeakness
} from '../types';
import { toast } from '../components/Toaster';
import { syncService } from './syncService';
import { lsManager } from '../lib/localStorageManager';

// ─── Constantes ──────────────────────────────────────────────────────────────

const LOCAL_STORAGE_KEY  = 'teachermada_user_data';
const SESSION_PREFIX     = 'tm_v3_session_';
const SETTINGS_KEY       = 'tm_system_settings';
const SUPPORT_QUOTA_KEY  = 'tm_support_quota';
const SETTINGS_TTL_MS    = 5 * 60 * 1000; // 5 minutes

// ─── Cache en mémoire pour les settings (survit aux re-renders) ──────────────
let settingsMemoryCache: { data: SystemSettings; expiry: number } | null = null;

// ─── Canaux Realtime actifs ──────────────────────────────────────────────────
let realtimeChannels: ReturnType<typeof supabase.channel>[] = [];

// ─── Event Bus Utilisateur ───────────────────────────────────────────────────
type UserUpdateListener = (user: UserProfile) => void;
let userListeners: UserUpdateListener[] = [];

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'error';
type SyncStatusListener = (status: SyncStatus) => void;

const notifyListeners = (user: UserProfile) => {
  userListeners.forEach(listener => {
    try { listener(user); } catch { /* ignoré */ }
  });
};

// ─── Mappers DB → App ────────────────────────────────────────────────────────

const mapProfile = (data: any): UserProfile => ({
  id: data.id,
  username: data.username || 'Utilisateur',
  email: data.email,
  role: data.role || 'user',
  credits: typeof data.credits === 'number' ? data.credits : 0,
  preferences: data.preferences ?? null,
  createdAt: data.created_at ? new Date(data.created_at).getTime() : Date.now(),
  updatedAt: data.updated_at ? new Date(data.updated_at).getTime() : Date.now(),
  isSuspended: data.is_suspended ?? false,
});

const formatLoginEmail = (input: string): string => {
  const trimmed = input.trim();
  if (trimmed.includes('@')) return trimmed;
  const cleanId = trimmed.replace(/[^a-zA-Z0-9.\-_+]/g, '');
  return `${cleanId}@teachermada.com`;
};

const createDefaultProfilePayload = (id: string, username: string, email: string) => ({
  id,
  username,
  email,
  role: 'user',
  credits: 6,
  preferences: null,
  is_suspended: false,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

// ─── SERVICE PRINCIPAL ───────────────────────────────────────────────────────

export const storageService = {

  // ══════════════════════════════════════════════════════════════════════════
  // SOUSCRIPTIONS
  // ══════════════════════════════════════════════════════════════════════════

  subscribeToSyncUpdates: (callback: SyncStatusListener): (() => void) => {
    return syncService.subscribe(callback);
  },

  subscribeToUserUpdates: (callback: UserUpdateListener): (() => void) => {
    userListeners.push(callback);
    return () => {
      userListeners = userListeners.filter(cb => cb !== callback);
    };
  },

  /**
   * Active Supabase Realtime pour les crédits et notifications.
   * À appeler une fois après connexion. Retourne une fonction de cleanup.
   *
   * CORRECTION : les crédits validés par l'admin sont maintenant visibles
   * instantanément sans rechargement de page.
   */
  subscribeToRealtime: (userId: string): (() => void) => {
    if (!isSupabaseConfigured()) return () => {};

    // Nettoyer les anciens canaux si on se reconnecte
    storageService.unsubscribeRealtime();

    // ── Canal 1 : Changements du profil (crédits, suspension) ──
    const profileChannel = supabase
      .channel(`tm_profile_${userId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` },
        (payload) => {
          const remote = payload.new as any;
          const local = storageService.getLocalUser();
          if (!local) return;

          const newCredits = typeof remote.credits === 'number' ? remote.credits : local.credits;
          const creditsGained = newCredits - local.credits;

          // Mise à jour locale depuis la source de vérité DB
          const updated: UserProfile = {
            ...local,
            credits: newCredits,
            isSuspended: remote.is_suspended ?? local.isSuspended,
            preferences: remote.preferences ?? local.preferences,
            updatedAt: new Date(remote.updated_at).getTime(),
          };
          storageService.saveLocalUser(updated);

          // Toast si crédits augmentent (validation paiement admin)
          if (creditsGained > 0) {
            toast(`🎉 +${creditsGained} crédits reçus !`, 'success');
          }
          // Toast si compte suspendu
          if (remote.is_suspended && !local.isSuspended) {
            toast('⚠️ Votre compte a été suspendu. Contactez l\'administrateur.', 'error');
          }
        }
      )
      .subscribe();

    // ── Canal 2 : Nouvelles notifications ──
    const notifChannel = supabase
      .channel(`tm_notifs_${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          const newNotif = payload.new as any;
          // Mettre à jour le cache local des notifications
          const localKey = `tm_notifications_${userId}`;
          const local = lsManager.safeGetJson<SmartNotification[]>(localKey, []);
          const mapped: SmartNotification = {
            id: newNotif.id,
            userId: newNotif.user_id,
            type: newNotif.type,
            title: newNotif.title,
            message: newNotif.message,
            read: false,
            createdAt: new Date(newNotif.created_at).getTime(),
            data: newNotif.data,
          };
          // Éviter les doublons
          if (!local.find(n => n.id === mapped.id)) {
            lsManager.safeSetJson(localKey, [mapped, ...local].slice(0, 50));
          }
          // Événement UI
          window.dispatchEvent(new CustomEvent('tm_new_notification', { detail: mapped }));
        }
      )
      .subscribe();

    realtimeChannels = [profileChannel, notifChannel];

    return () => storageService.unsubscribeRealtime();
  },

  unsubscribeRealtime: (): void => {
    for (const channel of realtimeChannels) {
      try { supabase.removeChannel(channel); } catch { /* ignoré */ }
    }
    realtimeChannels = [];
  },

  // ══════════════════════════════════════════════════════════════════════════
  // AUTHENTIFICATION
  // ══════════════════════════════════════════════════════════════════════════

  login: async (
    usernameOrEmail: string,
    password: string
  ): Promise<{ success: boolean; user?: UserProfile; error?: string }> => {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase non configuré.' };

    const email = formatLoginEmail(usernameOrEmail.trim());
    try {
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) return { success: false, error: authError.message };
      if (!authData?.user) return { success: false, error: 'Erreur de connexion.' };

      let user = await storageService.getUserById(authData.user.id);

      // Retry si profil en cours de création par trigger
      if (!user) {
        await new Promise(r => setTimeout(r, 600));
        user = await storageService.getUserById(authData.user.id);
      }

      // Auto-création en fallback
      if (!user) {
        const usernameFallback = authData.user.user_metadata?.username
          || email.split('@')[0];
        const payload = createDefaultProfilePayload(authData.user.id, usernameFallback, email);
        const { error: insertError } = await supabase.from('profiles').insert([payload]);
        if (insertError) return { success: false, error: 'Profil introuvable.' };
        user = mapProfile(payload);
      }

      if (user.isSuspended) return { success: false, error: "Compte suspendu par l'administrateur." };

      const localUser = storageService.getLocalUser();
      // Fusionner les préférences locales si la DB n'en a pas
      if (!user.preferences && localUser?.preferences && localUser.id === user.id) {
        user.preferences = localUser.preferences;
        storageService.saveUserProfile(user); // Resync en background
      }

      storageService.saveLocalUser(user);
      return { success: true, user };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  },

  register: async (
    username: string,
    password?: string,
    email?: string,
    phoneNumber?: string
  ): Promise<{ success: boolean; user?: UserProfile; error?: string }> => {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase non configuré.' };
    if (!password) return { success: false, error: 'Mot de passe requis.' };
    if (!username?.trim()) return { success: false, error: "Nom d'utilisateur requis." };

    const DEVICE_LIMIT = 3;
    const deviceCount = parseInt(lsManager.safeGet('tm_device_accounts_count') ?? '0', 10);
    if (deviceCount >= DEVICE_LIMIT) {
      return { success: false, error: `Limite de création de comptes atteinte (Max ${DEVICE_LIMIT}).` };
    }

    const finalEmail = email?.trim() || formatLoginEmail(username);

    try {
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: finalEmail,
        password,
        options: { data: { username: username.trim(), phone_number: phoneNumber?.trim() || '' } },
      });

      if (authError) return { success: false, error: authError.message };
      if (!authData.user) return { success: false, error: 'Erreur création compte.' };

      const payload = createDefaultProfilePayload(authData.user.id, username.trim(), finalEmail);
      const { error: insertError } = await supabase.from('profiles').insert([payload]);

      if (insertError && insertError.code !== '23505') {
        console.warn('Insertion profil (peut être ignorée si trigger actif):', insertError.message);
      }

      const newUser = mapProfile(payload);
      storageService.saveLocalUser(newUser);
      lsManager.safeSet('tm_device_accounts_count', String(deviceCount + 1));

      return { success: true, user: newUser };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  },

  logout: async (): Promise<void> => {
    storageService.unsubscribeRealtime();
    try { await supabase.auth.signOut(); } catch { /* ignoré si hors ligne */ }
    lsManager.safeRemove(LOCAL_STORAGE_KEY);
    lsManager.safeRemove('tm_v3_current_user_id');
  },

  resetPassword: async (emailOrUsername: string): Promise<{ success: boolean; error?: string }> => {
    if (!isSupabaseConfigured()) {
      await storageService.sendAdminRequest('system', 'admin', 'password_reset', undefined,
        `Demande de récupération pour: ${emailOrUsername}`);
      return { success: true };
    }
    try {
      const email = formatLoginEmail(emailOrUsername);
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      if (error) return { success: false, error: error.message };
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  },

  getCurrentUser: async (): Promise<UserProfile | null> => {
    const localUser = storageService.getLocalUser();
    if (!isSupabaseConfigured()) return localUser;

    try {
      const { data: { session }, error } = await supabase.auth.getSession();

      if (error) {
        if (error.message?.includes('Invalid Refresh Token') || error.message?.includes('Refresh Token Not Found')) {
          console.warn('Session expirée, déconnexion forcée.');
          await storageService.logout();
          return null;
        }
        throw error;
      }

      if (session?.user) {
        let dbUser = await storageService.getUserById(session.user.id);

        if (!dbUser) {
          console.warn('Profile manquant dans getCurrentUser, auto-création...');
          const email = session.user.email ?? '';
          const uname = session.user.user_metadata?.username || email.split('@')[0] || 'User';
          const payload = createDefaultProfilePayload(session.user.id, uname, email);
          const { error: insertError } = await supabase.from('profiles').insert([payload]);
          if (!insertError) dbUser = mapProfile(payload);
        }

        if (dbUser) {
          if (!dbUser.preferences && localUser?.preferences && localUser.id === dbUser.id) {
            dbUser.preferences = localUser.preferences;
            storageService.saveUserProfile(dbUser);
          }
          storageService.saveLocalUser(dbUser);
          return dbUser;
        }
      }
    } catch (e) {
      console.warn('Supabase inaccessible, fallback local:', e);
    }
    return localUser;
  },

  getLocalUser: (): UserProfile | null => {
    return lsManager.safeGetJson<UserProfile | null>(LOCAL_STORAGE_KEY, null);
  },

  saveLocalUser: (user: UserProfile): void => {
    lsManager.safeSetJson(LOCAL_STORAGE_KEY, user);
    notifyListeners(user);
  },

  getUserById: async (id: string): Promise<UserProfile | null> => {
    if (!isSupabaseConfigured()) return null;
    try {
      const { data, error } = await supabase
        .from('profiles').select('*').eq('id', id).single();
      if (error || !data) return null;
      return mapProfile(data);
    } catch {
      return null;
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  // PROFIL & SYNCHRONISATION
  // ══════════════════════════════════════════════════════════════════════════

  saveUserProfile: async (user: UserProfile): Promise<void> => {
    storageService.saveLocalUser(user); // Optimistic update
    if (isSupabaseConfigured()) {
      syncService.addToQueue('UPDATE_PROFILE', {
        id: user.id,
        username: user.username,
        preferences: user.preferences,
        updated_at: new Date().toISOString(),
      }, `profile_${user.id}`);
    }
  },

  getAllUsers: async (page = 0, pageSize = 50): Promise<UserProfile[]> => {
    if (!isSupabaseConfigured()) return [];
    try {
      const { data } = await supabase
        .from('profiles').select('*')
        .order('created_at', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);
      return data ? data.map(mapProfile) : [];
    } catch {
      return [];
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  // CRÉDITS (ATOMIQUES - CORRECTION CRITIQUE P1)
  // ══════════════════════════════════════════════════════════════════════════

  canRequest: async (userId: string, minCredits = 1): Promise<boolean> => {
    const local = storageService.getLocalUser();
    if (!local || local.id !== userId) return false;
    if (local.role === 'admin') return true;
    if (local.isSuspended) return false;
    return local.credits >= minCredits;
  },

  consumeCredit: async (userId: string): Promise<boolean> => {
    return storageService.deductCredits(userId, 1);
  },

  /**
   * CORRECTION P1 — Déduction atomique via RPC Supabase.
   *
   * La fonction SQL consume_credits_safe utilise FOR UPDATE pour éviter
   * les race conditions entre plusieurs appels simultanés.
   * En mode hors-ligne, la déduction est locale uniquement.
   */
  deductCredits: async (userId: string, amount: number): Promise<boolean> => {
    const local = storageService.getLocalUser();
    if (!local || local.id !== userId) return false;

    // Admin : pas de déduction
    if (local.role === 'admin') return true;

    // Mode hors-ligne : déduction locale optimiste
    if (!isSupabaseConfigured()) {
      if (local.credits < amount) return false;
      storageService.saveLocalUser({ ...local, credits: local.credits - amount });
      return true;
    }

    try {
      // ✅ ATOMIQUE : la RPC vérifie et déduit en une seule transaction SQL
      const { data, error } = await supabase.rpc('consume_credits_safe', {
        p_user_id: userId,
        p_amount: amount,
      });

      if (error) {
        console.warn('[Credits] RPC consume_credits_safe error:', error.message);
        // Fallback local si RPC échoue (ex: ancienne version DB)
        if (local.credits >= amount) {
          storageService.saveLocalUser({ ...local, credits: local.credits - amount });
          return true;
        }
        return false;
      }

      if (!data?.success) {
        console.warn('[Credits] Crédits insuffisants (côté DB):', data?.reason);
        // Resynchroniser les crédits locaux depuis la DB
        storageService.saveLocalUser({ ...local, credits: data?.current_balance ?? 0 });
        return false;
      }

      // Mettre à jour le cache local avec le solde réel retourné par la DB
      storageService.saveLocalUser({ ...local, credits: data.new_balance });
      return true;
    } catch (e) {
      console.warn('[Credits] Exception deductCredits:', e);
      // Fallback local en cas d'erreur réseau
      if (local.credits >= amount) {
        storageService.saveLocalUser({ ...local, credits: local.credits - amount });
        return true;
      }
      return false;
    }
  },

  addCredits: async (userId: string, amount: number): Promise<boolean> => {
    if (!isSupabaseConfigured()) return false;
    try {
      const { error } = await supabase.rpc('admin_add_credits', {
        p_target_user: userId,
        p_amount: amount,
      });
      if (!error) {
        // Mise à jour locale immédiate (Realtime le fera aussi, mais c'est plus rapide)
        const local = storageService.getLocalUser();
        if (local && local.id === userId) {
          storageService.saveLocalUser({ ...local, credits: local.credits + amount });
        }
      }
      return !error;
    } catch {
      return false;
    }
  },

  deductCreditOrUsage: async (userId: string) => {
    const success = await storageService.consumeCredit(userId);
    return success ? storageService.getLocalUser() : null;
  },

  canPerformRequest: async (userId: string) => {
    const allowed = await storageService.canRequest(userId);
    return { allowed };
  },

  // ══════════════════════════════════════════════════════════════════════════
  // SESSIONS D'APPRENTISSAGE
  // ══════════════════════════════════════════════════════════════════════════

  getSessionKey: (userId: string, prefs: UserPreferences): string => {
    const cleanMode = prefs.mode.replace(/\s/g, '_');
    const cleanLang = prefs.targetLanguage.split(' ')[0];
    return `${SESSION_PREFIX}${userId}_${cleanLang}_${prefs.level}_${cleanMode}`;
  },

  getOrCreateSession: async (userId: string, prefs: UserPreferences): Promise<LearningSession> => {
    const key = storageService.getSessionKey(userId, prefs);
    const cleanLang = prefs.targetLanguage.split(' ')[0];

    // 1. Charger local immédiatement (instant)
    const localData = lsManager.safeGet(key);
    let localSession: LearningSession | null = localData ? JSON.parse(localData) : null;

    // 2. Sync background avec Supabase (non-bloquant)
    if (isSupabaseConfigured()) {
      supabase.from('learning_sessions').select('*').eq('id', key).single()
        .then(({ data, error }) => {
          if (error || !data) return;
          const remote: LearningSession = {
            id: data.id,
            userId: data.user_id,
            type: data.type as any,
            language: data.language,
            level: data.level,
            messages: data.messages ?? [],
            updatedAt: new Date(data.updated_at).getTime(),
          };
          if (!localSession || remote.updatedAt > localSession.updatedAt) {
            lsManager.safeSetJson(key, remote);
            window.dispatchEvent(new CustomEvent('tm_session_updated', { detail: remote }));
          }
        })
        .catch(() => { /* hors ligne */ });
    }

    if (localSession) return localSession;

    // 3. Créer une nouvelle session
    const newSession: LearningSession = {
      id: key,
      userId,
      type: 'lesson',
      language: cleanLang,
      level: prefs.level,
      messages: [],
      updatedAt: Date.now(),
    };
    await storageService.saveSession(newSession);
    return newSession;
  },

  saveSession: async (session: LearningSession): Promise<void> => {
    session.updatedAt = Date.now();

    // Limiter à 50 messages (garder le premier système + les 49 derniers)
    if (session.messages.length > 50) {
      session.messages = [
        session.messages[0],
        ...session.messages.slice(-49),
      ];
    }

    // ✅ Écriture sécurisée via lsManager (anti-quota)
    lsManager.safeSetJson(session.id, session);

    if (isSupabaseConfigured()) {
      syncService.addToQueue('UPSERT_SESSION', {
        id: session.id,
        user_id: session.userId,
        type: session.type,
        language: session.language,
        level: session.level,
        messages: session.messages,
        updated_at: new Date(session.updatedAt).toISOString(),
      }, `session_${session.id}`);
    }
  },

  clearSession: (userId: string): void => {
    Object.keys(localStorage)
      .filter(k => k.startsWith(`${SESSION_PREFIX}${userId}`))
      .forEach(k => lsManager.safeRemove(k));
  },

  getChatHistory: (_lang: string): any[] => [],

  // ══════════════════════════════════════════════════════════════════════════
  // EXAMENS & CERTIFICATS
  // ══════════════════════════════════════════════════════════════════════════

  saveExamResult: async (result: ExamResult): Promise<void> => {
    try {
      lsManager.safeSetJson(`tm_exam_${result.id}`, result);
      if (!isSupabaseConfigured()) return;

      syncService.addToQueue('INSERT_EXAM', {
        id: result.id,
        user_id: result.userId,
        language: result.language,
        level: result.level,
        score: result.score,
        total_questions: result.totalQuestions,
        passed: result.passed,
        details: result.details,
        created_at: new Date(result.date).toISOString(),
      });
    } catch (e) {
      console.warn('Exam save error:', e);
    }
  },

  getExamResults: async (userId: string): Promise<ExamResult[]> => {
    let results: ExamResult[] = [];

    if (isSupabaseConfigured()) {
      try {
        const { data } = await supabase
          .from('exam_results').select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(20); // Pagination légère
        if (data) {
          results = data.map(d => ({
            id: d.id, userId: d.user_id, language: d.language, level: d.level,
            score: d.score, totalQuestions: d.total_questions, passed: d.passed,
            date: new Date(d.created_at).getTime(), details: d.details,
          }));
        }
      } catch (e) {
        console.warn('Fetch exams from Supabase failed:', e);
      }
    }

    if (results.length === 0) {
      const localResults = Object.keys(localStorage)
        .filter(k => k.startsWith('tm_exam_'))
        .map(k => lsManager.safeGetJson<ExamResult | null>(k, null))
        .filter((r): r is ExamResult => r !== null && r.userId === userId)
        .sort((a, b) => b.date - a.date);
      results = localResults;
    }

    return results;
  },

  saveCertificate: async (cert: Certificate): Promise<void> => {
    try {
      lsManager.safeSetJson(`tm_cert_${cert.id}`, cert);
      if (!isSupabaseConfigured()) return;

      syncService.addToQueue('INSERT_CERT', {
        id: cert.id, user_id: cert.userId, user_name: cert.userName,
        user_full_name: cert.userFullName, language: cert.language,
        level: cert.level, exam_id: cert.examId,
        issue_date: new Date(cert.issueDate).toISOString(),
        validation_hash: cert.validationHash, qr_code_data: cert.qrCodeData,
        score: cert.score, global_score: cert.globalScore, skill_scores: cert.skillScores,
      });
    } catch (e) {
      console.warn('Certificate save error:', e);
    }
  },

  getCertificates: async (userId: string): Promise<Certificate[]> => {
    if (!isSupabaseConfigured()) {
      return Object.keys(localStorage)
        .filter(k => k.startsWith('tm_cert_'))
        .map(k => lsManager.safeGetJson<Certificate | null>(k, null))
        .filter((c): c is Certificate => c !== null && c.userId === userId);
    }
    try {
      const { data } = await supabase
        .from('certificates').select('*')
        .eq('user_id', userId).order('issue_date', { ascending: false });
      return data ? data.map((d: any) => ({
        id: d.id, userId: d.user_id, userName: d.user_name, userFullName: d.user_full_name,
        language: d.language, level: d.level, examId: d.exam_id,
        issueDate: new Date(d.issue_date).getTime(), validationHash: d.validation_hash,
        qrCodeData: d.qr_code_data, score: d.score, globalScore: d.global_score,
        skillScores: d.skill_scores,
      })) : [];
    } catch {
      return [];
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  // NOTIFICATIONS
  // ══════════════════════════════════════════════════════════════════════════

  getNotifications: async (userId: string): Promise<SmartNotification[]> => {
    if (isSupabaseConfigured()) {
      try {
        const { data } = await supabase
          .from('notifications').select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(50);
        if (data) {
          const mapped: SmartNotification[] = data.map((d: any) => ({
            id: d.id, userId: d.user_id, type: d.type, title: d.title,
            message: d.message, read: d.read,
            createdAt: new Date(d.created_at).getTime(), data: d.data,
          }));
          lsManager.safeSetJson(`tm_notifications_${userId}`, mapped);
          return mapped;
        }
      } catch { /* fallback local */ }
    }
    return lsManager.safeGetJson<SmartNotification[]>(`tm_notifications_${userId}`, []);
  },

  getUnreadCount: async (userId: string): Promise<number> => {
    const notifs = await storageService.getNotifications(userId);
    return notifs.filter(n => !n.read).length;
  },

  createNotification: async (n: Omit<SmartNotification, 'id' | 'createdAt' | 'read'>): Promise<SmartNotification> => {
    const newNotif: SmartNotification = {
      ...n, id: crypto.randomUUID(), createdAt: Date.now(), read: false,
    };
    const localKey = `tm_notifications_${n.userId}`;
    const local = lsManager.safeGetJson<SmartNotification[]>(localKey, []);
    lsManager.safeSetJson(localKey, [newNotif, ...local].slice(0, 50));

    if (isSupabaseConfigured()) {
      syncService.addToQueue('INSERT_NOTIF', {
        id: newNotif.id, user_id: newNotif.userId, type: newNotif.type,
        title: newNotif.title, message: newNotif.message, read: false,
        data: newNotif.data, created_at: new Date().toISOString(),
      });
    }
    return newNotif;
  },

  markNotificationRead: async (userId: string, notifId: string): Promise<void> => {
    const localKey = `tm_notifications_${userId}`;
    const local = lsManager.safeGetJson<SmartNotification[]>(localKey, []);
    lsManager.safeSetJson(localKey, local.map(n => n.id === notifId ? { ...n, read: true } : n));
    if (isSupabaseConfigured()) {
      syncService.addToQueue('MARK_NOTIF_READ', { id: notifId });
    }
  },

  markAllNotificationsRead: async (userId: string): Promise<void> => {
    const localKey = `tm_notifications_${userId}`;
    const local = lsManager.safeGetJson<SmartNotification[]>(localKey, []);
    lsManager.safeSetJson(localKey, local.map(n => ({ ...n, read: true })));
    if (isSupabaseConfigured()) {
      syncService.addToQueue('MARK_ALL_NOTIF_READ', { userId });
    }
  },

  deleteNotification: async (userId: string, notifId: string): Promise<void> => {
    const localKey = `tm_notifications_${userId}`;
    const local = lsManager.safeGetJson<SmartNotification[]>(localKey, []);
    lsManager.safeSetJson(localKey, local.filter(n => n.id !== notifId));
    if (isSupabaseConfigured()) {
      syncService.addToQueue('DELETE_NOTIF', { id: notifId });
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  // SETTINGS SYSTÈME (avec cache TTL — CORRECTION AUDIT)
  // ══════════════════════════════════════════════════════════════════════════

  loadSystemSettings: async (): Promise<SystemSettings> => {
    const now = Date.now();

    // 1. Cache mémoire (plus rapide, re-renders)
    if (settingsMemoryCache && now < settingsMemoryCache.expiry) {
      return settingsMemoryCache.data;
    }

    // 2. Cache localStorage (survit aux rechargements)
    const localParsed = lsManager.safeGetJson<(SystemSettings & { _cachedAt?: number }) | null>(SETTINGS_KEY, null);
    if (localParsed?._cachedAt && now - localParsed._cachedAt < SETTINGS_TTL_MS) {
      settingsMemoryCache = { data: localParsed, expiry: localParsed._cachedAt + SETTINGS_TTL_MS };
      return localParsed;
    }

    // 3. Fetch Supabase (seulement si nécessaire)
    if (isSupabaseConfigured()) {
      try {
        const { data, error } = await supabase.from('system_settings').select('*').single();
        if (!error && data) {
          let coupons: CouponCode[] = [];
          if (Array.isArray(data.valid_transaction_refs)) {
            coupons = data.valid_transaction_refs
              .map((r: any) => {
                if (typeof r === 'string') {
                  try { return JSON.parse(r); } catch { return { code: r, amount: 0, createdAt: new Date().toISOString() }; }
                }
                return r;
              })
              .filter((c: any) => c?.code);
          }
          const settings: SystemSettings = {
            creditPrice: data.credit_price ?? 50,
            validTransactionRefs: coupons,
            adminContact: data.admin_contact ?? { telma: '034XXXXXXX', airtel: '033XXXXXXX', orange: '032XXXXXXX' },
            updatedAt: now,
          };
          const toCache = { ...settings, _cachedAt: now };
          lsManager.safeSetJson(SETTINGS_KEY, toCache);
          settingsMemoryCache = { data: settings, expiry: now + SETTINGS_TTL_MS };
          return settings;
        }
      } catch { /* ignoré */ }
    }

    return storageService.getSystemSettings();
  },

  getSystemSettings: (): SystemSettings => {
    const local = lsManager.safeGetJson<SystemSettings | null>(SETTINGS_KEY, null);
    if (local) return local;
    return {
      creditPrice: 50,
      validTransactionRefs: [],
      adminContact: { telma: '034XXXXXXX', airtel: '033XXXXXXX', orange: '032XXXXXXX' },
      updatedAt: Date.now(),
    };
  },

  updateSystemSettings: async (settings: SystemSettings): Promise<boolean> => {
    // Invalider les caches
    settingsMemoryCache = null;
    lsManager.safeRemove(SETTINGS_KEY);
    lsManager.safeSetJson(SETTINGS_KEY, settings);

    if (!isSupabaseConfigured()) return true;
    try {
      const { error } = await supabase.from('system_settings').upsert({
        id: 1,
        credit_price: settings.creditPrice,
        valid_transaction_refs: settings.validTransactionRefs,
        admin_contact: settings.adminContact,
        updated_at: new Date().toISOString(),
      });
      return !error;
    } catch {
      return false;
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ADMIN
  // ══════════════════════════════════════════════════════════════════════════

  getAdminRequests: async (): Promise<AdminRequest[]> => {
    if (!isSupabaseConfigured()) return [];
    try {
      const { data } = await supabase
        .from('admin_requests').select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      return data ? data.map((d: any) => ({
        id: d.id, userId: d.user_id, username: d.username, type: d.type,
        amount: d.amount, message: d.message, status: d.status,
        createdAt: d.created_at ? new Date(d.created_at).getTime() : Date.now(),
      })) : [];
    } catch {
      return [];
    }
  },

  sendAdminRequest: async (
    userId: string, username: string,
    type: 'credit' | 'password_reset' | 'message',
    amount?: number, message?: string, contact?: string
  ): Promise<{ status: 'pending' | 'approved' }> => {
    if (!isSupabaseConfigured()) return { status: 'pending' };
    try {
      const fullMessage = contact ? `${message} [Contact: ${contact}]` : message;
      await supabase.from('admin_requests').insert([{
        user_id: userId, username, type, amount, message: fullMessage, status: 'pending',
      }]);
      return { status: 'pending' };
    } catch {
      return { status: 'pending' };
    }
  },

  resolveRequest: async (reqId: string, status: 'approved' | 'rejected'): Promise<void> => {
    try {
      const { data: req } = await supabase
        .from('admin_requests').select('*').eq('id', reqId).single();

      if (status === 'approved' && req?.type === 'credit' && req?.amount) {
        await storageService.addCredits(req.user_id, req.amount);
        await storageService.createNotification({
          userId: req.user_id, type: 'admin',
          title: 'Demande Approuvée',
          message: `Votre demande de ${req.amount} crédits a été validée.`,
        });
      } else if (status === 'rejected' && req) {
        await storageService.createNotification({
          userId: req.user_id, type: 'admin',
          title: 'Demande Refusée',
          message: 'Votre demande a été refusée par l\'administrateur.',
        });
      }
      await supabase.from('admin_requests').update({ status }).eq('id', reqId);
    } catch (e) {
      console.warn('resolveRequest error:', e);
    }
  },

  cleanupOldRequests: async (): Promise<void> => {
    try {
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      await supabase.from('admin_requests').delete()
        .lt('created_at', oneWeekAgo).neq('status', 'pending');
    } catch { /* ignoré */ }
  },

  // ══════════════════════════════════════════════════════════════════════════
  // VOCABULAIRE
  // ══════════════════════════════════════════════════════════════════════════

  saveVocabulary: async (userId: string, language: string, words: any[]): Promise<void> => {
    lsManager.safeSetJson(`tm_vocab_${userId}_${language}`, words);
    if (!isSupabaseConfigured()) return;
    try {
      // Upsert en batch (max 50 mots pour éviter les timeouts)
      const batch = words.slice(0, 50).map(w => ({
        user_id: userId, language, word: w.word, translation: w.translation,
        example: w.example, level: w.level, added_at: new Date(w.addedAt ?? Date.now()).toISOString(),
      }));
      await supabase.from('user_vocabulary').upsert(batch, { onConflict: 'user_id,language,word' });
    } catch (e) {
      console.warn('saveVocabulary error:', e);
    }
  },

  getVocabulary: async (userId: string, language: string): Promise<any[]> => {
    const localKey = `tm_vocab_${userId}_${language}`;
    if (isSupabaseConfigured()) {
      try {
        const { data } = await supabase
          .from('user_vocabulary').select('*')
          .eq('user_id', userId).eq('language', language)
          .order('added_at', { ascending: false }).limit(200);
        if (data) {
          const mapped = data.map((d: any) => ({
            word: d.word, translation: d.translation, example: d.example,
            level: d.level, addedAt: new Date(d.added_at).getTime(),
          }));
          lsManager.safeSetJson(localKey, mapped);
          return mapped;
        }
      } catch { /* fallback */ }
    }
    return lsManager.safeGetJson<any[]>(localKey, []);
  },

  // ══════════════════════════════════════════════════════════════════════════
  // FAIBLESSES UTILISATEUR
  // ══════════════════════════════════════════════════════════════════════════

  getUserWeaknesses: async (userId: string): Promise<UserWeakness[]> => {
    if (!isSupabaseConfigured()) return [];
    try {
      const { data, error } = await supabase
        .from('user_weakness').select('*')
        .eq('user_id', userId)
        .order('error_count', { ascending: false }).limit(10);
      if (error) return [];
      return data.map((w: any) => ({
        id: w.id, userId: w.user_id, category: w.category, tag: w.tag,
        errorCount: w.error_count, lastSeen: new Date(w.last_seen).getTime(),
      }));
    } catch {
      return [];
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  // CODES PROMO / COUPONS
  // ══════════════════════════════════════════════════════════════════════════

  redeemCode: async (userId: string, inputCode: string): Promise<{ success: boolean; amount?: number; message?: string }> => {
    try {
      const code = inputCode.trim().toUpperCase();
      const settings = await storageService.loadSystemSettings();
      const validRefs = settings.validTransactionRefs ?? [];

      const idx = validRefs.findIndex(c => c.code.toUpperCase() === code);
      if (idx === -1) return { success: false, message: 'Code invalide ou déjà utilisé.' };

      const coupon = validRefs[idx];
      const amount = Number(coupon.amount) ?? 0;

      const ok = await storageService.addCredits(userId, amount);
      if (!ok) return { success: false, message: 'Erreur technique.' };

      await storageService.createNotification({
        userId, type: 'credit',
        title: 'Crédits Reçus',
        message: `Vous avez reçu ${amount} crédits via le code ${code}.`,
      });

      const newRefs = [...validRefs];
      newRefs.splice(idx, 1);
      await storageService.updateSystemSettings({ ...settings, validTransactionRefs: newRefs });

      return { success: true, amount };
    } catch {
      return { success: false, message: 'Erreur technique.' };
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  // SUPPORT AGENT (QUOTA)
  // ══════════════════════════════════════════════════════════════════════════

  canUseSupportAgent: (): boolean => {
    const today = new Date().toDateString();
    const data = lsManager.safeGetJson<{ date: string; count: number }>(SUPPORT_QUOTA_KEY, { date: today, count: 0 });
    if (data.date !== today) return true; // Nouveau jour = quota reset
    return data.count < 100;
  },

  incrementSupportUsage: (): void => {
    const today = new Date().toDateString();
    const data = lsManager.safeGetJson<{ date: string; count: number }>(SUPPORT_QUOTA_KEY, { date: today, count: 0 });
    const updated = data.date === today
      ? { ...data, count: data.count + 1 }
      : { date: today, count: 1 };
    lsManager.safeSetJson(SUPPORT_QUOTA_KEY, updated);
  },

  // ══════════════════════════════════════════════════════════════════════════
  // EXPORT / IMPORT
  // ══════════════════════════════════════════════════════════════════════════

  exportData: async (user: UserProfile): Promise<void> => {
    const blob = new Blob([JSON.stringify(user, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
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
        const updated = { username: data.username, preferences: data.preferences };
        const { error } = await supabase.from('profiles').update(updated).eq('id', currentUserId);
        return !error;
      }
    } catch { /* ignoré */ }
    return false;
  },
};
