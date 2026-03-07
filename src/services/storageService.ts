import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { UserProfile, UserPreferences, LearningSession, AdminRequest, SystemSettings, CouponCode, ExamResult, Certificate, SmartNotification, UserWeakness } from "../types";
import { toast } from "../components/Toaster";
import { syncService } from "./syncService";

const LOCAL_STORAGE_KEY = 'teachermada_user_data';
const SESSION_PREFIX = 'tm_v3_session_';
const SETTINGS_KEY = 'tm_system_settings';
const SUPPORT_QUOTA_KEY = 'tm_support_quota';

type UserUpdateListener = (user: UserProfile) => void;
let userListeners: UserUpdateListener[] = [];

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'error';
type SyncStatusListener = (status: SyncStatus) => void;
let syncListeners: SyncStatusListener[] = [];
let currentSyncStatus: SyncStatus = 'synced';

const notifyListeners = (user: UserProfile) => { userListeners.forEach(l => l(user)); };
const notifySyncListeners = (status: SyncStatus) => { currentSyncStatus = status; syncListeners.forEach(l => l(status)); };

const mapProfile = (data: any): UserProfile => ({
    id: data.id,
    username: data.username || "Utilisateur",
    email: data.email,
    phoneNumber: data.phone_number || '',
    role: data.role || 'user',
    credits: data.credits ?? 0,
    preferences: data.preferences,
    createdAt: new Date(data.created_at).getTime(),
    updatedAt: new Date(data.updated_at).getTime(),
    isSuspended: data.is_suspended
});

const formatLoginEmail = (input: string) => {
    const trimmed = input.trim();
    if (trimmed.includes('@')) return trimmed;
    return `${trimmed.replace(/[^a-zA-Z0-9.\-_+]/g, '')}@teachermada.com`;
};

const createDefaultProfilePayload = (id: string, username: string, email: string) => ({
    id, username, email, role: 'user', credits: 6, preferences: null,
    is_suspended: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString()
});

export const storageService = {
  subscribeToSyncUpdates: (callback: SyncStatusListener) => syncService.subscribe(callback),
  subscribeToUserUpdates: (callback: UserUpdateListener) => {
      userListeners.push(callback);
      return () => { userListeners = userListeners.filter(l => l !== callback); };
  },
  getSyncStatus: () => currentSyncStatus,

  resetPassword: async (identifier: string): Promise<{success: boolean, error?: string}> => {
    if (!isSupabaseConfigured()) return { success: false, error: "Supabase non configuré (Mode hors ligne)." };
    let email = identifier.trim();
    if (!email.includes('@')) {
        try {
            const { data, error } = await supabase.from('profiles').select('email').eq('username', email).single();
            if (error || !data?.email) return { success: false, error: "Utilisateur introuvable." };
            email = data.email;
        } catch (e) { return { success: false, error: "Erreur technique lors de la recherche." }; }
    }
    try {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
        if (error) return { success: false, error: error.message };
        return { success: true };
    } catch (e: any) { return { success: false, error: e.message }; }
  },

  login: async (id: string, pass: string): Promise<{success: boolean, user?: UserProfile, error?: string}> => {
    if (!isSupabaseConfigured()) return { success: false, error: "Supabase non configuré (Mode hors ligne)." };
    try {
        let email = id.trim();
        if (!email.includes('@')) {
            try {
                const isPhone = /^[0-9+\s\-]{7,15}$/.test(email.replace(/\s/g, ''));
                const { data } = await supabase
                    .from('profiles').select('email')
                    .or(isPhone ? `phone_number.eq.${email.replace(/\s/g,'')}` : `username.eq.${email}`)
                    .maybeSingle();
                if (data?.email) {
                    email = data.email;
                } else {
                    if (isPhone) {
                        const { data: byUser } = await supabase.from('profiles').select('email').eq('username', email).maybeSingle();
                        email = byUser?.email || formatLoginEmail(id);
                    } else {
                        email = formatLoginEmail(id);
                    }
                }
            } catch (e) { email = formatLoginEmail(id); }
        }
        
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password: pass });
        if (authError) return { success: false, error: "Identifiants incorrects." };
        if (!authData?.user) return { success: false, error: "Erreur de connexion." };

        let user = await storageService.getUserById(authData.user.id);
        if (!user) {
            await new Promise(resolve => setTimeout(resolve, 500));
            user = await storageService.getUserById(authData.user.id);
        }
        if (!user) {
            const usernameFallback = authData.user.user_metadata?.username || email.split('@')[0];
            const payload = createDefaultProfilePayload(authData.user.id, usernameFallback, email);
            const { error: insertError } = await supabase.from('profiles').insert([payload]);
            if (insertError) return { success: false, error: "Profil introuvable et impossible à recréer automatiquement." };
            user = mapProfile(payload);
        }
        if (user.isSuspended) return { success: false, error: "Compte suspendu par l'administrateur." };
        storageService.saveLocalUser(user);
        return { success: true, user };
    } catch (e: any) {
        console.error("Login exception:", e);
        return { success: false, error: e.message };
    }
  },

  register: async (username: string, password?: string, email?: string, phoneNumber?: string): Promise<{success: boolean, user?: UserProfile, error?: string}> => {
    if (!isSupabaseConfigured()) return { success: false, error: "Supabase non configuré (Mode hors ligne)." };
    const DEVICE_ACCOUNT_LIMIT = 3;
    const currentCount = parseInt(localStorage.getItem('tm_device_accounts_count') || '0', 10);
    if (currentCount >= DEVICE_ACCOUNT_LIMIT) return { success: false, error: "Limite de création de comptes atteinte sur cet appareil (Max 3)." };
    if (!password) return { success: false, error: "Mot de passe requis." };
    if (!username) return { success: false, error: "Nom d'utilisateur requis." };
    let finalEmail = email?.trim() || "";
    if (!finalEmail) finalEmail = formatLoginEmail(username);
    try {
        const { data: authData, error: authError } = await supabase.auth.signUp({
            email: finalEmail, password,
            options: { data: { username: username.trim(), phone_number: phoneNumber?.trim() || "" } }
        });
        if (authError) return { success: false, error: authError.message };
        if (!authData.user) return { success: false, error: "Erreur création compte." };
        const payload = createDefaultProfilePayload(authData.user.id, username.trim(), finalEmail);
        const { error: insertError } = await supabase.from('profiles').insert([payload]);
        if (insertError && insertError.code !== '23505') console.warn("Erreur insertion profil:", insertError);
        const newUser = mapProfile(payload);
        storageService.saveLocalUser(newUser);
        localStorage.setItem('tm_device_accounts_count', (currentCount + 1).toString());
        return { success: true, user: newUser };
    } catch (e: any) { return { success: false, error: e.message }; }
  },

  logout: async () => {
      try { await supabase.auth.signOut(); } catch (e) { console.warn("Logout error (network):", e); }
      localStorage.removeItem(LOCAL_STORAGE_KEY);
      localStorage.removeItem('tm_v3_current_user_id');
      Object.keys(localStorage).filter(k => k.startsWith('tm_v3_session_')).forEach(k => localStorage.removeItem(k));
  },

  updateAccountInfo: async (userId: string, updates: { username?: string; email?: string; phoneNumber?: string; newPassword?: string; currentPassword?: string; }): Promise<{ success: boolean; error?: string }> => {
      if (!isSupabaseConfigured()) return { success: false, error: "Supabase non configuré." };
      try {
          if (updates.newPassword && updates.currentPassword) {
              const { data: sessionData } = await supabase.auth.getSession();
              const currentEmail = sessionData?.session?.user?.email;
              if (!currentEmail) return { success: false, error: "Session expirée. Reconnectez-vous." };
              const { error: reAuthError } = await supabase.auth.signInWithPassword({ email: currentEmail, password: updates.currentPassword });
              if (reAuthError) return { success: false, error: "Mot de passe actuel incorrect." };
              const { error: pwError } = await supabase.auth.updateUser({ password: updates.newPassword });
              if (pwError) return { success: false, error: pwError.message };
          }
          if (updates.email) {
              const { error: emailError } = await supabase.auth.updateUser({ email: updates.email });
              if (emailError) return { success: false, error: emailError.message };
          }
          const profileUpdates: any = { updated_at: new Date().toISOString() };
          if (updates.username) profileUpdates.username = updates.username.trim();
          if (updates.email) profileUpdates.email = updates.email.trim();
          if (updates.phoneNumber !== undefined) profileUpdates.phone_number = updates.phoneNumber.trim();
          if (Object.keys(profileUpdates).length > 1) {
              const { error: dbError } = await supabase.from('profiles').update(profileUpdates).eq('id', userId);
              if (dbError) return { success: false, error: dbError.message };
          }
          const local = storageService.getLocalUser();
          if (local && local.id === userId) {
              const updated: any = { ...local };
              if (updates.username) updated.username = updates.username.trim();
              if (updates.email) updated.email = updates.email.trim();
              if (updates.phoneNumber !== undefined) updated.phoneNumber = updates.phoneNumber.trim();
              storageService.saveLocalUser(updated);
          }
          return { success: true };
      } catch (e: any) { return { success: false, error: e.message }; }
  },

  getCurrentUser: async (): Promise<UserProfile | null> => {
      const localUser = storageService.getLocalUser();
      if (!isSupabaseConfigured()) return localUser;
      try {
          const { data: { session }, error } = await supabase.auth.getSession();
          if (error) {
              if (error.message?.includes("Invalid Refresh Token") || error.message?.includes("Refresh Token Not Found")) {
                  await storageService.logout(); return null;
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
                  if (!dbUser.preferences && localUser?.preferences && localUser.id === dbUser.id) {
                      dbUser.preferences = localUser.preferences;
                      storageService.saveUserProfile(dbUser);
                  }
                  storageService.saveLocalUser(dbUser);
                  return dbUser;
              }
          }
      } catch (e) { console.warn("Supabase offline or not configured, falling back to local user."); }
      return localUser;
  },

  getLocalUser: (): UserProfile | null => {
      const data = localStorage.getItem(LOCAL_STORAGE_KEY);
      return data ? JSON.parse(data) : null;
  },

  saveLocalUser: (user: UserProfile) => {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(user));
      notifyListeners(user);
  },

  getUserById: async (id: string): Promise<UserProfile | null> => {
      if (!isSupabaseConfigured()) return null;
      try {
          const { data, error } = await supabase.from('profiles').select('*').eq('id', id).single();
          if (error || !data) return null;
          return mapProfile(data);
      } catch { return null; }
  },

  saveUserProfile: async (user: UserProfile) => {
      storageService.saveLocalUser(user);
      if (isSupabaseConfigured()) {
          await syncService.addToQueue('UPDATE_PROFILE', { id: user.id, username: user.username, preferences: user.preferences, updated_at: new Date().toISOString() }, `profile_${user.id}`);
      }
  },

  getAllUsers: async (): Promise<UserProfile[]> => {
      if (!isSupabaseConfigured()) return [];
      try {
          const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
          return data ? data.map(mapProfile) : [];
      } catch { return []; }
  },

  canRequest: async (userId: string, minCredits: number = 1): Promise<boolean> => {
      const localUser = storageService.getLocalUser();
      if (!localUser || localUser.id !== userId) return false;
      if (localUser.role === 'admin') return true;
      if (localUser.isSuspended) return false;
      return localUser.credits >= minCredits;
  },

  consumeCredit: async (userId: string): Promise<boolean> => storageService.deductCredits(userId, 1),

  deductCredits: async (userId: string, amount: number): Promise<boolean> => {
      const local = storageService.getLocalUser();
      if (!local || local.credits < amount) return false;
      storageService.saveLocalUser({ ...local, credits: local.credits - amount });
      if (!isSupabaseConfigured()) return true;
      try {
          supabase.rpc('consume_credits', { p_user_id: userId, p_amount: amount }).then(({ data, error }) => {
              if (!error && typeof data === 'number') {
                  const cur = storageService.getLocalUser();
                  if (cur) storageService.saveLocalUser({ ...cur, credits: data });
              }
          });
          return true;
      } catch (e) { return true; }
  },

  addCredits: async (userId: string, amount: number): Promise<boolean> => {
      if (!isSupabaseConfigured()) return false;
      try {
          const { error } = await supabase.rpc('admin_add_credits', { p_target_user: userId, p_amount: amount });
          return !error;
      } catch { return false; }
  },

  saveExamResult: async (result: ExamResult) => {
      try {
          localStorage.setItem(`tm_exam_${result.id}`, JSON.stringify(result));
          if (!isSupabaseConfigured()) return;
          await syncService.addToQueue('INSERT_EXAM', {
              id: result.id, user_id: result.userId, language: result.language, level: result.level,
              score: result.score, total_questions: result.totalQuestions, passed: result.passed,
              details: result.details, created_at: new Date(result.date).toISOString()
          });
      } catch (e) { console.warn("Exam save error:", e); }
  },

  getExamResults: async (userId: string): Promise<ExamResult[]> => {
      let results: ExamResult[] = [];
      if (isSupabaseConfigured()) {
          try {
              const { data } = await supabase.from('exam_results').select('*').eq('user_id', userId).order('created_at', { ascending: false });
              if (data) results = data.map(d => ({ id: d.id, userId: d.user_id, language: d.language, level: d.level, score: d.score, totalQuestions: d.total_questions, passed: d.passed, date: new Date(d.created_at).getTime(), details: d.details }));
          } catch (e) { console.warn("Supabase fetch exams failed", e); }
      }
      if (results.length === 0) {
          const keys = Object.keys(localStorage).filter(k => k.startsWith('tm_exam_'));
          const local = keys.map(k => JSON.parse(localStorage.getItem(k) || '{}')).filter((r: ExamResult) => r.userId === userId);
          local.sort((a, b) => b.date - a.date);
          if (local.length > 0) results = local;
      }
      return results;
  },

  saveCertificate: async (cert: Certificate) => {
      try {
          localStorage.setItem(`tm_cert_${cert.id}`, JSON.stringify(cert));
          if (!isSupabaseConfigured()) return;
          await syncService.addToQueue('INSERT_CERT', {
              id: cert.id, user_id: cert.userId, user_name: cert.userName, user_full_name: cert.userFullName,
              language: cert.language, level: cert.level, exam_id: cert.examId,
              issue_date: new Date(cert.issueDate).toISOString(), validation_hash: cert.validationHash,
              qr_code_data: cert.qrCodeData, score: cert.score, global_score: cert.globalScore, skill_scores: cert.skillScores
          });
      } catch (e) { console.warn("Certificate save error:", e); }
  },

  getCertificates: async (userId: string): Promise<Certificate[]> => {
      if (!isSupabaseConfigured()) {
          const keys = Object.keys(localStorage).filter(k => k.startsWith('tm_cert_'));
          return keys.map(k => JSON.parse(localStorage.getItem(k) || '{}')).filter(c => c.userId === userId);
      }
      try {
          const { data } = await supabase.from('certificates').select('*').eq('user_id', userId).order('issue_date', { ascending: false });
          return data ? data.map(d => ({ id: d.id, userId: d.user_id, userName: d.user_name, userFullName: d.user_full_name, language: d.language, level: d.level, examId: d.exam_id, issueDate: new Date(d.issue_date).getTime(), validationHash: d.validation_hash, qrCodeData: d.qr_code_data, score: d.score, globalScore: d.global_score, skillScores: d.skill_scores })) : [];
      } catch { return []; }
  },

  getCertificateById: async (certId: string): Promise<Certificate | null> => {
      const local = localStorage.getItem(`tm_cert_${certId}`);
      if (local) return JSON.parse(local);
      if (isSupabaseConfigured()) {
          try {
              const { data } = await supabase.from('certificates').select('*').eq('id', certId).single();
              if (data) return { id: data.id, userId: data.user_id, userName: data.user_name, userFullName: data.user_full_name, language: data.language, level: data.level, examId: data.exam_id, issueDate: new Date(data.issue_date).getTime(), validationHash: data.validation_hash, qrCodeData: data.qr_code_data, score: data.score, globalScore: data.global_score, skillScores: data.skill_scores };
          } catch (e) { console.warn("Cert verification fetch error", e); }
      }
      return null;
  },

  getNotifications: async (userId: string): Promise<SmartNotification[]> => {
      if (isSupabaseConfigured()) {
          try {
              const { data } = await supabase.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(50);
              if (data) return data.map(n => ({ id: n.id, userId: n.user_id, type: n.type, title: n.title, message: n.message, read: n.read, createdAt: new Date(n.created_at).getTime(), data: n.data }));
          } catch {}
      }
      return JSON.parse(localStorage.getItem(`tm_notifications_${userId}`) || "[]");
  },

  createNotification: async (notif: { userId: string; type: string; title: string; message: string; data?: any }) => {
      const newNotif: SmartNotification = { id: `notif_${Date.now()}`, userId: notif.userId, type: notif.type as any, title: notif.title, message: notif.message, read: false, createdAt: Date.now(), data: notif.data };
      const localKey = `tm_notifications_${notif.userId}`;
      const local = JSON.parse(localStorage.getItem(localKey) || "[]");
      local.unshift(newNotif);
      localStorage.setItem(localKey, JSON.stringify(local.slice(0, 50)));
      if (isSupabaseConfigured()) {
          await syncService.addToQueue('INSERT_NOTIF', { id: newNotif.id, user_id: notif.userId, type: notif.type, title: notif.title, message: notif.message, read: false, data: notif.data, created_at: new Date(newNotif.createdAt).toISOString() });
      }
  },

  markNotificationRead: async (userId: string, notifId: string) => {
      const localKey = `tm_notifications_${userId}`;
      const local = JSON.parse(localStorage.getItem(localKey) || "[]");
      localStorage.setItem(localKey, JSON.stringify(local.map((n: SmartNotification) => n.id === notifId ? { ...n, read: true } : n)));
      if (isSupabaseConfigured()) await syncService.addToQueue('MARK_NOTIF_READ', { id: notifId });
  },

  markAllNotificationsRead: async (userId: string) => {
      const localKey = `tm_notifications_${userId}`;
      const local = JSON.parse(localStorage.getItem(localKey) || "[]");
      localStorage.setItem(localKey, JSON.stringify(local.map((n: SmartNotification) => ({ ...n, read: true }))));
      if (isSupabaseConfigured()) await syncService.addToQueue('MARK_ALL_NOTIF_READ', { userId });
  },

  deleteNotification: async (userId: string, notifId: string) => {
      const localKey = `tm_notifications_${userId}`;
      const local = JSON.parse(localStorage.getItem(localKey) || "[]");
      localStorage.setItem(localKey, JSON.stringify(local.filter((n: SmartNotification) => n.id !== notifId)));
      if (isSupabaseConfigured()) await syncService.addToQueue('DELETE_NOTIF', { id: notifId });
  },

  getUserWeaknesses: async (userId: string): Promise<UserWeakness[]> => {
      if (!isSupabaseConfigured()) return [];
      const { data, error } = await supabase.from('user_weakness').select('*').eq('user_id', userId).order('error_count', { ascending: false }).limit(10);
      if (error) return [];
      return data.map((w: any) => ({ id: w.id, userId: w.user_id, category: w.category, tag: w.tag, errorCount: w.error_count, lastSeen: new Date(w.last_seen).getTime() }));
  },

  recordWeakness: async (userId: string, category: string, tag: string) => {
      if (!isSupabaseConfigured()) return;
      await syncService.addToQueue('UPSERT_WEAKNESS', { user_id: userId, category, tag });
  },

  getSessionKey: (userId: string, prefs: UserPreferences) => {
      return `${SESSION_PREFIX}${userId}_${prefs.targetLanguage.split(' ')[0]}_${prefs.level}_${prefs.mode.replace(/\s/g, '_')}`;
  },

  getOrCreateSession: async (userId: string, prefs: UserPreferences): Promise<LearningSession> => {
      const key = storageService.getSessionKey(userId, prefs);
      const localData = localStorage.getItem(key);
      let localSession: LearningSession | null = localData ? JSON.parse(localData) : null;
      if (isSupabaseConfigured()) {
          supabase.from('learning_sessions').select('*').eq('id', key).single().then(({ data, error }) => {
              if (error || !data) return;
              const remote: LearningSession = { id: data.id, userId: data.user_id, type: data.type as any, language: data.language, level: data.level, messages: data.messages || [], updatedAt: new Date(data.updated_at).getTime() };
              if (!localSession || remote.updatedAt > localSession.updatedAt) {
                  localStorage.setItem(key, JSON.stringify(remote));
                  window.dispatchEvent(new CustomEvent('tm_session_updated', { detail: remote }));
              }
          });
      }
      if (localSession) return localSession;
      const newSession: LearningSession = { id: key, userId, type: 'lesson', language: prefs.targetLanguage.split(' ')[0], level: prefs.level, messages: [], updatedAt: Date.now() };
      await storageService.saveSession(newSession);
      return newSession;
  },

  saveSession: async (session: LearningSession) => {
      session.updatedAt = Date.now();
      if (session.messages.length > 50) session.messages = [session.messages[0], ...session.messages.slice(-49)];
      localStorage.setItem(session.id, JSON.stringify(session));
      if (isSupabaseConfigured()) {
          syncService.addToQueue('UPSERT_SESSION', { id: session.id, user_id: session.userId, type: session.type, language: session.language, level: session.level, messages: session.messages, updated_at: new Date(session.updatedAt).toISOString() }, `session_${session.id}`);
      }
  },

  clearSession: (userId: string) => {
      Object.keys(localStorage).filter(k => k.startsWith(`${SESSION_PREFIX}${userId}`)).forEach(k => localStorage.removeItem(k));
  },

  getChatHistory: (lang: string): any[] => [],

  getAdminRequests: async (): Promise<AdminRequest[]> => {
      if (!isSupabaseConfigured()) return [];
      try {
          const { data } = await supabase.from('admin_requests').select('*').order('created_at', { ascending: false });
          return data ? data.map(d => ({ id: d.id, userId: d.user_id, username: d.username, type: d.type, amount: d.amount, message: d.message, status: d.status, createdAt: d.created_at ? new Date(d.created_at).getTime() : Date.now() })) : [];
      } catch { return []; }
  },

  cleanupOldRequests: async () => {
      try { await supabase.from('admin_requests').delete().lt('created_at', new Date(Date.now() - 7*24*60*60*1000).toISOString()); } catch {}
  },

  sendAdminRequest: async (userId: string, username: string, type: 'credit' | 'password_reset' | 'message', amount?: number, message?: string, contact?: string): Promise<{ status: 'pending' | 'approved' }> => {
      if (!isSupabaseConfigured()) return { status: 'pending' };
      try {
          const fullMessage = contact ? `${message} [Contact: ${contact}]` : message;
          await supabase.from('admin_requests').insert([{ user_id: userId, username, type, amount, message: fullMessage, status: 'pending' }]);
          return { status: 'pending' };
      } catch { return { status: 'pending' }; }
  },

  resolveRequest: async (reqId: string, status: 'approved' | 'rejected') => {
      try {
          if (status === 'approved') {
              const { data: req } = await supabase.from('admin_requests').select('*').eq('id', reqId).single();
              if (req?.type === 'credit' && req?.amount) {
                  await storageService.addCredits(req.user_id, req.amount);
                  await storageService.createNotification({ userId: req.user_id, type: 'admin', title: 'Demande Approuvée', message: `Votre demande de ${req.amount} crédits a été validée par l'administrateur.` });
              }
          } else {
              const { data: req } = await supabase.from('admin_requests').select('*').eq('id', reqId).single();
              if (req) await storageService.createNotification({ userId: req.user_id, type: 'admin', title: 'Demande Refusée', message: `Votre demande a été refusée par l'administrateur.` });
          }
          await supabase.from('admin_requests').update({ status }).eq('id', reqId);
      } catch (e) { console.warn("Resolve request error:", e); }
  },

  loadSystemSettings: async (): Promise<SystemSettings> => {
      if (!isSupabaseConfigured()) return storageService.getSystemSettings();
      try {
          const { data, error } = await supabase.from('system_settings').select('*').single();
          if (!error && data) {
              let normalizedCoupons: CouponCode[] = [];
              if (Array.isArray(data.valid_transaction_refs)) {
                  normalizedCoupons = data.valid_transaction_refs.map((r: any) => { if (typeof r === 'string') { try { return JSON.parse(r); } catch { return { code: r, amount: 0, createdAt: new Date().toISOString() }; } } return r; }).filter((c: any) => c?.code);
              }
              const settings: SystemSettings = { creditPrice: data.credit_price || 50, validTransactionRefs: normalizedCoupons, adminContact: data.admin_contact || { telma: "0349310268", airtel: "0333878420", orange: "0326979017" }, updatedAt: Date.now() };
              localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
              return settings;
          }
      } catch {}
      return storageService.getSystemSettings();
  },

  getSystemSettings: (): SystemSettings => {
      const local = localStorage.getItem(SETTINGS_KEY);
      if (local) return JSON.parse(local);
      return { creditPrice: 50, validTransactionRefs: [], adminContact: { telma: "0349310268", airtel: "0333878420", orange: "0326979017" }, updatedAt: Date.now() };
  },

  updateSystemSettings: async (settings: SystemSettings): Promise<boolean> => {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      if (!isSupabaseConfigured()) return true;
      try {
          const { error } = await supabase.from('system_settings').upsert({ id: 1, credit_price: settings.creditPrice, valid_transaction_refs: settings.validTransactionRefs, admin_contact: settings.adminContact });
          return !error;
      } catch { return false; }
  },

  deductCreditOrUsage: async (userId: string) => {
      const success = await storageService.consumeCredit(userId);
      return success ? storageService.getLocalUser() : null;
  },

  canPerformRequest: async (userId: string) => ({ allowed: await storageService.canRequest(userId) }),

  exportData: async (user: UserProfile) => {
      const blob = new Blob([JSON.stringify(user, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `teachermada_${user.username}_backup.json`; a.click();
  },

  importData: async (file: File, currentUserId: string): Promise<boolean> => {
      try {
          const data = JSON.parse(await file.text());
          if (data.username) { const { error } = await supabase.from('profiles').update({ username: data.username, preferences: data.preferences }).eq('id', currentUserId); return !error; }
      } catch {}
      return false;
  },

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
      localStorage.setItem(SUPPORT_QUOTA_KEY, JSON.stringify(data));
  },

  redeemCode: async (userId: string, inputCode: string): Promise<{ success: boolean; amount?: number; message?: string }> => {
      try {
          const code = inputCode.trim().toUpperCase();
          const settings = await storageService.loadSystemSettings();
          const validRefs = settings.validTransactionRefs || [];
          const couponIndex = validRefs.findIndex(c => c.code.toUpperCase() === code);
          if (couponIndex !== -1) {
              const amountToAdd = Number(validRefs[couponIndex].amount) || 0;
              const creditAdded = await storageService.addCredits(userId, amountToAdd);
              if (!creditAdded) return { success: false, message: "Erreur technique." };
              await storageService.createNotification({ userId, type: 'credit', title: 'Crédits Reçus', message: `Vous avez reçu ${amountToAdd} crédits via le code ${code}.` });
              const newRefs = [...validRefs];
              newRefs.splice(couponIndex, 1);
              await storageService.updateSystemSettings({ ...settings, validTransactionRefs: newRefs });
              return { success: true, amount: amountToAdd };
          }
          return { success: false, message: "Code invalide ou déjà utilisé." };
      } catch { return { success: false, message: "Erreur technique." }; }
  }
};
