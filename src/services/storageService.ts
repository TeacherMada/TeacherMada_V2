import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { UserProfile, UserPreferences, LearningSession, AdminRequest, SystemSettings, CouponCode, ExamResult, Certificate, SmartNotification, UserWeakness } from "../types";
import { toast } from "../components/Toaster";
import { syncService } from "./syncService";

const LOCAL_STORAGE_KEY = 'teachermada_user_data';
const SESSION_PREFIX = 'tm_v3_session_';
const SETTINGS_KEY = 'tm_system_settings';
const SUPPORT_QUOTA_KEY = 'tm_support_quota';

// ── Cache TTL pour loadSystemSettings (évite N+1 requêtes) ──────────────────
const SETTINGS_TTL_MS = 5 * 60 * 1000; // 5 minutes
let settingsMemoryCache: { data: SystemSettings; expiry: number } | null = null;

// --- EVENT BUS FOR REAL-TIME UPDATES ---
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

// Helper to map Supabase DB shape to UserProfile
const mapProfile = (data: any): UserProfile => ({
    id: data.id,
    username: data.username || "Utilisateur",
    email: data.email,
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
    const cleanId = trimmed.replace(/[^a-zA-Z0-9.\-_+]/g, '');
    return `${cleanId}@teachermada.com`;
};

const createDefaultProfilePayload = (id: string, username: string, email: string) => ({
    id: id,
    username: username,
    email: email,
    role: 'user',
    credits: 6,
    preferences: null,
    is_suspended: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
});

export const storageService = {

  subscribeToSyncUpdates: (callback: SyncStatusListener) => {
      return syncService.subscribe(callback);
  },

  subscribeToUserUpdates: (callback: UserUpdateListener) => {
      userListeners.push(callback);
      return () => {
          userListeners = userListeners.filter(cb => cb !== callback);
      };
  },

  // ── Realtime Supabase (nom original conservé) ────────────────────────────
  subscribeToRemoteChanges: (userId: string) => {
      if (!isSupabaseConfigured()) return () => {};

      console.log(`[Realtime] Subscribing to changes for user ${userId}`);
      const channel = supabase
          .channel(`public:profiles:id=eq.${userId}`)
          .on(
              'postgres_changes',
              {
                  event: 'UPDATE',
                  schema: 'public',
                  table: 'profiles',
                  filter: `id=eq.${userId}`
              },
              (payload) => {
                  if (payload.new) {
                      const mappedUser = mapProfile(payload.new);
                      const currentUser = storageService.getLocalUser();

                      if (currentUser) {
                          if (
                              currentUser.credits === mappedUser.credits &&
                              currentUser.isSuspended === mappedUser.isSuspended &&
                              JSON.stringify(currentUser.preferences) === JSON.stringify(mappedUser.preferences)
                          ) {
                              return;
                          }

                          const merged = {
                              ...currentUser,
                              ...mappedUser,
                              preferences: (mappedUser.preferences && Object.keys(mappedUser.preferences).length > 0)
                                  ? mappedUser.preferences
                                  : currentUser.preferences
                          };
                          storageService.saveLocalUser(merged);

                          if (mappedUser.credits > currentUser.credits) {
                              toast.success(`🎉 +${mappedUser.credits - currentUser.credits} crédits reçus !`);
                          }
                          if (mappedUser.isSuspended && !currentUser.isSuspended) {
                              toast.error("⚠️ Votre compte a été suspendu. Contactez l'administrateur.");
                          }
                          console.log('[Realtime] Profile updated from server');
                      } else {
                          storageService.saveLocalUser(mappedUser);
                      }
                  }
              }
          )
          .subscribe();

      return () => {
          console.log(`[Realtime] Unsubscribing for user ${userId}`);
          supabase.removeChannel(channel);
      };
  },

  // --- AUTH ---

  resetPassword: async (identifier: string): Promise<{success: boolean, error?: string}> => {
      if (!isSupabaseConfigured()) return { success: false, error: "Supabase non configuré (Mode hors ligne)." };
      try {
          const email = formatLoginEmail(identifier);
          const { error } = await supabase.auth.resetPasswordForEmail(email);
          if (error) return { success: false, error: error.message };
          return { success: true };
      } catch (e: any) {
          return { success: false, error: e.message };
      }
  },

  login: async (usernameOrEmail: string, password: string): Promise<{success: boolean, user?: UserProfile, error?: string}> => {
      if (!isSupabaseConfigured()) return { success: false, error: "Supabase non configuré (Mode hors ligne)." };
      const email = formatLoginEmail(usernameOrEmail);
      try {
          const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
          if (authError) return { success: false, error: authError.message };
          if (!authData || !authData.user) return { success: false, error: "Erreur de connexion." };

          if (authData.user) {
              let user = await storageService.getUserById(authData.user.id);

              if (!user) {
                  await new Promise(resolve => setTimeout(resolve, 500));
                  user = await storageService.getUserById(authData.user.id);
              }

              if (!user) {
                  console.warn("Profile not found, attempting to auto-create for ID:", authData.user.id);
                  const usernameFallback = authData.user.user_metadata?.username || email.split('@')[0];
                  const payload = createDefaultProfilePayload(authData.user.id, usernameFallback, email);
                  const { error: insertError } = await supabase.from('profiles').insert([payload]);
                  if (insertError) {
                      console.error("Failed to auto-create profile:", insertError);
                      return { success: false, error: "Profil introuvable et impossible à recréer automatiquement." };
                  }
                  user = mapProfile(payload);
              }

              if (user.isSuspended) return { success: false, error: "Compte suspendu par l'administrateur." };
              storageService.saveLocalUser(user);
              return { success: true, user };
          }
          return { success: false, error: "Erreur inconnue." };
      } catch (e: any) {
          console.error("Login exception:", e);
          return { success: false, error: e.message };
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

      if (error) {
          console.error("Error fetching weaknesses:", error);
          return [];
      }

      return data.map((w: any) => ({
          id: w.id,
          userId: w.user_id,
          category: w.category,
          tag: w.tag,
          errorCount: w.error_count,
          lastSeen: new Date(w.last_seen).getTime()
      }));
  },

  register: async (username: string, password?: string, email?: string, phoneNumber?: string): Promise<{success: boolean, user?: UserProfile, error?: string}> => {
      if (!isSupabaseConfigured()) return { success: false, error: "Supabase non configuré (Mode hors ligne)." };

      const DEVICE_ACCOUNT_LIMIT = 3;
      const currentCount = parseInt(localStorage.getItem('tm_device_accounts_count') || '0', 10);
      if (currentCount >= DEVICE_ACCOUNT_LIMIT) {
          return { success: false, error: "Limite de création de comptes atteinte sur cet appareil (Max 3)." };
      }

      if (!password) return { success: false, error: "Mot de passe requis." };
      if (!username) return { success: false, error: "Nom d'utilisateur requis." };

      let finalEmail = email?.trim() || "";
      if (!finalEmail) finalEmail = formatLoginEmail(username);

      try {
          const { data: authData, error: authError } = await supabase.auth.signUp({
              email: finalEmail,
              password: password,
              options: { data: { username: username.trim(), phone_number: phoneNumber?.trim() || "" } }
          });

          if (authError) return { success: false, error: authError.message };
          if (!authData.user) return { success: false, error: "Erreur création compte." };

          const payload = createDefaultProfilePayload(authData.user.id, username.trim(), finalEmail);
          const { error: insertError } = await supabase.from('profiles').insert([payload]);

          if (insertError && insertError.code !== '23505') {
              console.warn("Erreur insertion profil (peut être ignorée si trigger actif):", insertError);
          }

          const newUser = mapProfile(payload);
          storageService.saveLocalUser(newUser);
          localStorage.setItem('tm_device_accounts_count', (currentCount + 1).toString());

          return { success: true, user: newUser };
      } catch (e: any) {
          return { success: false, error: e.message };
      }
  },

    /*
  logout: async () => {
      try {
          await supabase.auth.signOut();
      } catch (e) {
          console.warn("Logout error (network):", e);
      }
      localStorage.removeItem(LOCAL_STORAGE_KEY);
      localStorage.removeItem('tm_v3_current_user_id');
  }, remplacé par Ceci :*/
    logout: async () => {
  await supabase.auth.signOut();          // ① Déco Supabase
  localStorage.removeItem('tm_user');    // ② Vider le cache user
  localStorage.removeItem('tm_session'); // ③ Vider la session
    }

  getCurrentUser: async (): Promise<UserProfile | null> => {
      const localUser = storageService.getLocalUser();

      if (!isSupabaseConfigured()) return localUser;

      try {
          const { data: { session }, error } = await supabase.auth.getSession();

          if (error) {
              if (error.message && (error.message.includes("Invalid Refresh Token") || error.message.includes("Refresh Token Not Found"))) {
                  console.warn("Session expired (Invalid Refresh Token), clearing local data.");
                  await storageService.logout();
                  return null;
              }
              throw error;
          }

          if (session?.user) {
              let dbUser = await storageService.getUserById(session.user.id);

              if (!dbUser) {
                  console.warn("Profile missing in getCurrentUser, auto-creating...");
                  const email = session.user.email || '';
                  const usernameFallback = session.user.user_metadata?.username || email.split('@')[0] || 'User';
                  const payload = createDefaultProfilePayload(session.user.id, usernameFallback, email);
                  const { error: insertError } = await supabase.from('profiles').insert([payload]);
                  if (!insertError) {
                      dbUser = mapProfile(payload);
                  }
              }

              if (dbUser) {
                  if (!dbUser.preferences && localUser?.preferences && localUser.id === dbUser.id) {
                      console.log("Restoring preferences from local storage");
                      dbUser.preferences = localUser.preferences;
                      storageService.saveUserProfile(dbUser);
                  }
                  storageService.saveLocalUser(dbUser);
                  return dbUser;
              }
          }
      } catch (e) {
          console.warn("Supabase offline or not configured, falling back to local user.");
      }

      return localUser;
  },

  getLocalUser: (): UserProfile | null => {
      const data = localStorage.getItem(LOCAL_STORAGE_KEY);
      return data ? JSON.parse(data) : null;
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

  // --- SYNC ---
  saveUserProfile: async (user: UserProfile) => {
      storageService.saveLocalUser(user);

      if (isSupabaseConfigured()) {
          const updates = {
              id: user.id,
              username: user.username,
              preferences: user.preferences,
              updated_at: new Date().toISOString()
          };
          await syncService.addToQueue('UPDATE_PROFILE', updates, `profile_${user.id}`);
      }
  },

  getAllUsers: async (): Promise<UserProfile[]> => {
      if (!isSupabaseConfigured()) return [];
      try {
          const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
          return data ? data.map(mapProfile) : [];
      } catch {
          return [];
      }
  },

  // --- CREDITS ---

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

  // ── CORRECTION P1 : Déduction atomique via RPC consume_credits_safe ─────────
  deductCredits: async (userId: string, amount: number): Promise<boolean> => {
      const local = storageService.getLocalUser();
      if (!local || local.id !== userId) return false;
      if (local.role === 'admin') return true;

      if (!isSupabaseConfigured()) {
          if (local.credits < amount) return false;
          storageService.saveLocalUser({ ...local, credits: local.credits - amount });
          return true;
      }

      try {
          const { data, error } = await supabase.rpc('consume_credits_safe', {
              p_user_id: userId,
              p_amount: amount
          });

          if (error) {
              console.warn("RPC consume_credits_safe failed:", error.message);
              // Fallback local si RPC indisponible
              if (local.credits >= amount) {
                  storageService.saveLocalUser({ ...local, credits: local.credits - amount });
                  return true;
              }
              return false;
          }

          if (!data?.success) {
              console.warn("Crédits insuffisants (DB):", data?.reason);
              if (typeof data?.current_balance === 'number') {
                  storageService.saveLocalUser({ ...local, credits: data.current_balance });
              }
              return false;
          }

          // Mettre à jour avec le solde réel retourné par la DB
          storageService.saveLocalUser({ ...local, credits: data.new_balance });
          return true;

      } catch (e) {
          console.warn("Error deducting credits:", e);
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
              p_amount: amount
          });
          return !error;
      } catch (e) {
          console.warn("Error adding credits:", e);
          return false;
      }
  },

  // --- EXAMS & CERTIFICATES ---
  saveExamResult: async (result: ExamResult) => {
      try {
          safeLocalSet(`tm_exam_${result.id}`, JSON.stringify(result));
          if (!isSupabaseConfigured()) return;

          const payload = {
              id: result.id,
              user_id: result.userId,
              language: result.language,
              level: result.level,
              score: result.score,
              total_questions: result.totalQuestions,
              passed: result.passed,
              details: result.details,
              created_at: new Date(result.date).toISOString()
          };
          await syncService.addToQueue('INSERT_EXAM', payload);
      } catch (e) {
          console.warn("Exam save error:", e);
      }
  },

  getExamResults: async (userId: string): Promise<ExamResult[]> => {
      let results: ExamResult[] = [];

      if (isSupabaseConfigured()) {
          try {
              const { data } = await supabase.from('exam_results').select('*').eq('user_id', userId).order('created_at', { ascending: false });
              if (data) {
                  results = data.map(d => ({
                      id: d.id,
                      userId: d.user_id,
                      language: d.language,
                      level: d.level,
                      score: d.score,
                      totalQuestions: d.total_questions,
                      passed: d.passed,
                      date: new Date(d.created_at).getTime(),
                      details: d.details
                  }));
              }
          } catch (e) {
              console.warn("Supabase fetch exams failed, falling back to local", e);
          }
      }

      if (results.length === 0) {
          const keys = Object.keys(localStorage).filter(k => k.startsWith('tm_exam_'));
          const localResults = keys.map(k => {
              try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch { return {}; }
          }).filter((r: ExamResult) => r.userId === userId);
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
              id: cert.id,
              user_id: cert.userId,
              user_name: cert.userName,
              user_full_name: cert.userFullName,
              language: cert.language,
              level: cert.level,
              exam_id: cert.examId,
              issue_date: new Date(cert.issueDate).toISOString(),
              validation_hash: cert.validationHash,
              qr_code_data: cert.qrCodeData,
              score: cert.score,
              global_score: cert.globalScore,
              skill_scores: cert.skillScores
          };
          await syncService.addToQueue('INSERT_CERT', payload);
      } catch (e) {
          console.warn("Certificate save error:", e);
      }
  },

  getCertificates: async (userId: string): Promise<Certificate[]> => {
      if (!isSupabaseConfigured()) {
          const keys = Object.keys(localStorage).filter(k => k.startsWith('tm_cert_'));
          return keys.map(k => {
              try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch { return null; }
          }).filter(c => c && c.userId === userId);
      }
      try {
          const { data } = await supabase.from('certificates').select('*').eq('user_id', userId).order('issue_date', { ascending: false });
          return data ? data.map((d: any) => ({
              id: d.id,
              userId: d.user_id,
              userName: d.user_name,
              userFullName: d.user_full_name,
              language: d.language,
              level: d.level,
              examId: d.exam_id,
              issueDate: new Date(d.issue_date).getTime(),
              validationHash: d.validation_hash,
              qrCodeData: d.qr_code_data,
              score: d.score,
              globalScore: d.global_score,
              skillScores: d.skill_scores
          })) : [];
      } catch {
          return [];
      }
  },

  getCertificateById: async (certId: string): Promise<Certificate | null> => {
      const local = localStorage.getItem(`tm_cert_${certId}`);
      if (local) {
          try { return JSON.parse(local); } catch { /* ignoré */ }
      }

      if (isSupabaseConfigured()) {
          try {
              const { data } = await supabase.from('certificates').select('*').eq('id', certId).single();
              if (data) {
                  return {
                      id: data.id,
                      userId: data.user_id,
                      userName: data.user_name,
                      userFullName: data.user_full_name,
                      language: data.language,
                      level: data.level,
                      examId: data.exam_id,
                      issueDate: new Date(data.issue_date).getTime(),
                      validationHash: data.validation_hash,
                      qrCodeData: data.qr_code_data,
                      score: data.score,
                      globalScore: data.global_score,
                      skillScores: data.skill_scores
                  };
              }
          } catch (e) {
              console.warn("Cert verification fetch error", e);
          }
      }
      return null;
  },

  // --- NOTIFICATIONS ---
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
                      id: n.id,
                      userId: n.user_id,
                      type: n.type,
                      title: n.title,
                      message: n.message,
                      read: n.read,
                      createdAt: new Date(n.created_at).getTime(),
                      data: n.data
                  }));
                  safeLocalSet(`tm_notifications_${userId}`, JSON.stringify(mapped));
                  return mapped;
              }
          } catch (e) {
              // Fallback local
          }
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
          id: crypto.randomUUID(),
          createdAt: Date.now(),
          read: false
      };

      const userId = n.userId;
      const localKey = `tm_notifications_${userId}`;
      const local = JSON.parse(localStorage.getItem(localKey) || "[]");
      safeLocalSet(localKey, JSON.stringify([newNotif, ...local].slice(0, 50)));

      if (isSupabaseConfigured()) {
          const payload = {
              id: newNotif.id,
              user_id: newNotif.userId,
              type: newNotif.type,
              title: newNotif.title,
              message: newNotif.message,
              read: false,
              data: newNotif.data,
              created_at: new Date().toISOString()
          };
          await syncService.addToQueue('INSERT_NOTIF', payload);
      }

      return newNotif;
  },

  markNotificationRead: async (userId: string, notifId: string) => {
      const localKey = `tm_notifications_${userId}`;
      const local = JSON.parse(localStorage.getItem(localKey) || "[]");
      const updated = local.map((n: SmartNotification) => n.id === notifId ? { ...n, read: true } : n);
      safeLocalSet(localKey, JSON.stringify(updated));

      if (isSupabaseConfigured()) {
          await syncService.addToQueue('MARK_NOTIF_READ', { id: notifId });
      }
  },

  markAllNotificationsRead: async (userId: string) => {
      const localKey = `tm_notifications_${userId}`;
      const local = JSON.parse(localStorage.getItem(localKey) || "[]");
      const updated = local.map((n: SmartNotification) => ({ ...n, read: true }));
      safeLocalSet(localKey, JSON.stringify(updated));

      if (isSupabaseConfigured()) {
          await syncService.addToQueue('MARK_ALL_NOTIF_READ', { userId });
      }
  },

  deleteNotification: async (userId: string, notifId: string) => {
      const localKey = `tm_notifications_${userId}`;
      const local = JSON.parse(localStorage.getItem(localKey) || "[]");
      const updated = local.filter((n: SmartNotification) => n.id !== notifId);
      safeLocalSet(localKey, JSON.stringify(updated));

      if (isSupabaseConfigured()) {
          await syncService.addToQueue('DELETE_NOTIF', { id: notifId });
      }
  },

  // --- OTHERS ---
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
              if (!creditAdded) return { success: false, message: "Erreur technique." };

              await storageService.createNotification({
                  userId,
                  type: 'credit',
                  title: 'Crédits Reçus',
                  message: `Vous avez reçu ${amountToAdd} crédits via le code ${code}.`
              });

              const newRefs = [...validRefs];
              newRefs.splice(couponIndex, 1);
              await storageService.updateSystemSettings({ ...settings, validTransactionRefs: newRefs });

              return { success: true, amount: amountToAdd };
          }
          return { success: false, message: "Code invalide ou déjà utilisé." };
      } catch {
          return { success: false, message: "Erreur technique." };
      }
  },

  // --- SESSIONS ---
  getSessionKey: (userId: string, prefs: UserPreferences) => {
      const cleanMode = prefs.mode.replace(/\s/g, '_');
      const cleanLang = prefs.targetLanguage.split(' ')[0];
      return `${SESSION_PREFIX}${userId}_${cleanLang}_${prefs.level}_${cleanMode}`;
  },

  getOrCreateSession: async (userId: string, prefs: UserPreferences): Promise<LearningSession> => {
      const key = storageService.getSessionKey(userId, prefs);
      const cleanLang = prefs.targetLanguage.split(' ')[0];

      const localData = localStorage.getItem(key);
      let localSession: LearningSession | null = localData ? JSON.parse(localData) : null;

      if (isSupabaseConfigured()) {
          // ✅ Promise.resolve() pour avoir .catch() sur le résultat Supabase
          Promise.resolve(
              supabase.from('learning_sessions').select('*').eq('id', key).single()
          ).then(({ data, error }) => {
              if (error) {
                  console.log("Background sync info:", error.message);
                  return;
              }
              if (data) {
                  const remoteSession: LearningSession = {
                      id: data.id,
                      userId: data.user_id,
                      type: data.type as any,
                      language: data.language,
                      level: data.level,
                      messages: data.messages || [],
                      updatedAt: new Date(data.updated_at).getTime()
                  };

                  if (!localSession || remoteSession.updatedAt > localSession.updatedAt) {
                      safeLocalSet(key, JSON.stringify(remoteSession));
                      window.dispatchEvent(new CustomEvent('tm_session_updated', { detail: remoteSession }));
                  }
              }
          }).catch(() => { /* hors ligne, ignoré */ });
      }

      if (localSession) return localSession;

      const newSession: LearningSession = {
          id: key,
          userId,
          type: 'lesson',
          language: cleanLang,
          level: prefs.level,
          messages: [],
          updatedAt: Date.now()
      };
      await storageService.saveSession(newSession);
      return newSession;
  },

  saveSession: async (session: LearningSession) => {
      session.updatedAt = Date.now();

      if (session.messages.length > 50) {
          session.messages = [
              session.messages[0],
              ...session.messages.slice(-49)
          ];
      }

      safeLocalSet(session.id, JSON.stringify(session));

      if (isSupabaseConfigured()) {
          syncService.addToQueue('UPSERT_SESSION', {
              id: session.id,
              user_id: session.userId,
              type: session.type,
              language: session.language,
              level: session.level,
              messages: session.messages,
              updated_at: new Date(session.updatedAt).toISOString()
          }, `session_${session.id}`);
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

  // --- ADMIN ---
  getAdminRequests: async (): Promise<AdminRequest[]> => {
      if (!isSupabaseConfigured()) return [];
      try {
          const { data } = await supabase.from('admin_requests').select('*').order('created_at', { ascending: false });
          return data ? data.map(d => ({
              id: d.id, userId: d.user_id, username: d.username, type: d.type,
              amount: d.amount, message: d.message, status: d.status,
              createdAt: d.created_at ? new Date(d.created_at).getTime() : Date.now()
          })) : [];
      } catch { return []; }
  },

  cleanupOldRequests: async () => {
      try {
          const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
          await supabase.from('admin_requests').delete().lt('created_at', oneWeekAgo);
      } catch {}
  },

  sendAdminRequest: async (userId: string, username: string, type: 'credit' | 'password_reset' | 'message', amount?: number, message?: string, contact?: string): Promise<{ status: 'pending' | 'approved' }> => {
      if (!isSupabaseConfigured()) return { status: 'pending' };
      try {
          const fullMessage = contact ? `${message} [Contact: ${contact}]` : message;
          const newReq = { user_id: userId, username, type, amount, message: fullMessage, status: 'pending' };
          await supabase.from('admin_requests').insert([newReq]);
          return { status: 'pending' };
      } catch {
          return { status: 'pending' };
      }
  },

  resolveRequest: async (reqId: string, status: 'approved' | 'rejected') => {
      try {
          if (status === 'approved') {
              const { data: req } = await supabase.from('admin_requests').select('*').eq('id', reqId).single();
              if (req && req.type === 'credit' && req.amount) {
                  await storageService.addCredits(req.user_id, req.amount);
                  await storageService.createNotification({
                      userId: req.user_id,
                      type: 'admin',
                      title: 'Demande Approuvée',
                      message: `Votre demande de ${req.amount} crédits a été validée par l'administrateur.`
                  });
              }
          } else if (status === 'rejected') {
              const { data: req } = await supabase.from('admin_requests').select('*').eq('id', reqId).single();
              if (req) {
                  await storageService.createNotification({
                      userId: req.user_id,
                      type: 'admin',
                      title: 'Demande Refusée',
                      message: `Votre demande a été refusée par l'administrateur.`
                  });
              }
          }
          await supabase.from('admin_requests').update({ status }).eq('id', reqId);
      } catch (e) {
          console.warn("Resolve request error:", e);
      }
  },

  // ── CORRECTION : loadSystemSettings avec cache TTL 5min ──────────────────
  // ── CORRECTION : lit "valid_coupons" (vrai nom colonne dans votre DB) ────
  loadSystemSettings: async (): Promise<SystemSettings> => {
      const now = Date.now();

      // 1. Cache mémoire (survit aux re-renders, évite les requêtes répétées)
      if (settingsMemoryCache && now < settingsMemoryCache.expiry) {
          return settingsMemoryCache.data;
      }

      // 2. Cache localStorage avec TTL 5 minutes
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

      // 3. Fetch Supabase (seulement si cache expiré)
      if (!isSupabaseConfigured()) return storageService.getSystemSettings();
      try {
          const { data, error } = await supabase.from('system_settings').select('*').single();
          if (!error && data) {
              let normalizedCoupons: CouponCode[] = [];
              // ✅ Lire "valid_coupons" (votre vrai nom) avec fallback sur l'ancien nom
              const rawCoupons = data.valid_coupons ?? data.valid_transaction_refs ?? [];
              if (Array.isArray(rawCoupons)) {
                  normalizedCoupons = rawCoupons.map((r: any) => {
                      if (typeof r === 'string') {
                          try { return JSON.parse(r); } catch { return { code: r, amount: 0, createdAt: new Date().toISOString() }; }
                      }
                      return r;
                  }).filter((c: any) => c && c.code);
              }

              const settings: SystemSettings = {
                  creditPrice: data.credit_price || 50,
                  validTransactionRefs: normalizedCoupons,
                  adminContact: data.admin_contact || { telma: "0349310268", airtel: "0333878420", orange: "0326979017" },
                  updatedAt: now,
              };

              const toCache = { ...settings, _cachedAt: now };
              safeLocalSet(SETTINGS_KEY, JSON.stringify(toCache));
              settingsMemoryCache = { data: settings, expiry: now + SETTINGS_TTL_MS };
              return settings;
          }
      } catch {}
      return storageService.getSystemSettings();
  },

  getSystemSettings: (): SystemSettings => {
      const local = localStorage.getItem(SETTINGS_KEY);
      if (local) {
          try { return JSON.parse(local); } catch { /* ignoré */ }
      }
      return {
          creditPrice: 50,
          validTransactionRefs: [],
          adminContact: { telma: "0349310268", airtel: "0333878420", orange: "0326979017" },
          updatedAt: Date.now()
      };
  },

  // ✅ CORRECTION : écrit dans "valid_coupons" (vrai nom colonne dans votre DB)
  updateSystemSettings: async (settings: SystemSettings): Promise<boolean> => {
      settingsMemoryCache = null; // Invalider le cache
      safeLocalSet(SETTINGS_KEY, JSON.stringify(settings));

      if (!isSupabaseConfigured()) return true;
      try {
          const payload = {
              id: 1,
              credit_price: settings.creditPrice,
              valid_coupons: settings.validTransactionRefs,
              admin_contact: settings.adminContact
          };
          const { error } = await supabase.from('system_settings').upsert(payload);
          return !error;
      } catch {
          return false;
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
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `teachermada_${user.username}_backup.json`;
      a.click();
      URL.revokeObjectURL(url);
  },

  importData: async (file: File, currentUserId: string): Promise<boolean> => {
      try {
          const text = await file.text();
          const data = JSON.parse(text);
          if (data.username) {
              const updated = {
                  username: data.username, preferences: data.preferences
              };
              const { error } = await supabase.from('profiles').update(updated).eq('id', currentUserId);
              return !error;
          }
      } catch {}
      return false;
  }
};
