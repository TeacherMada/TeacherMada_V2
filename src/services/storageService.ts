import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { UserProfile, UserPreferences, LearningSession, AdminRequest, SystemSettings, CouponCode, ExamResult, Certificate, SmartNotification } from "../types";

const LOCAL_STORAGE_KEY = 'teachermada_user_data';
const SESSION_PREFIX = 'tm_v3_session_';
const SETTINGS_KEY = 'tm_system_settings';
const SUPPORT_QUOTA_KEY = 'tm_support_quota';

// --- EVENT BUS FOR REAL-TIME UPDATES v ---
type UserUpdateListener = (user: UserProfile) => void;
let userListeners: UserUpdateListener[] = [];

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'error';
type SyncStatusListener = (status: SyncStatus) => void;
let syncListeners: SyncStatusListener[] = [];

let currentSyncStatus: SyncStatus = 'synced';

const notifyListeners = (user: UserProfile) => {
    userListeners.forEach(listener => listener(user));
};

const notifySyncListeners = (status: SyncStatus) => {
    currentSyncStatus = status;
    syncListeners.forEach(listener => listener(status));
};

// Helper to map Supabase DB shape to UserProfile
const mapProfile = (data: any): UserProfile => ({
    id: data.id,
    username: data.username || "Utilisateur",
    fullName: data.full_name || data.username || "Utilisateur", // Map full_name
    email: data.email,
    phoneNumber: data.phone_number,
    role: data.role || 'user',
    credits: data.credits ?? 0,
    xp: data.xp ?? 0,
    stats: {
        lessonsCompleted: data.lessons_completed || 0,
        exercisesCompleted: data.exercises_completed || 0,
        dialoguesCompleted: data.dialogues_completed || 0
    },
    preferences: data.preferences,
    vocabulary: data.vocabulary || [],
    freeUsage: data.free_usage || { count: 0, lastResetWeek: new Date().toISOString() },
    aiMemory: typeof data.ai_memory === 'string' 
        ? JSON.parse(data.ai_memory) 
        : (data.ai_memory || {
            masteredVocabulary: [],
            frequentErrors: [],
            completedConcepts: [],
            currentDifficulties: [],
            lastLesson: "Introduction",
            weeklyGoal: "Découverte",
            successRate: 100,
            lastUpdate: Date.now()
        }),
    createdAt: new Date(data.created_at).getTime(),
    isSuspended: data.is_suspended
});

const formatLoginEmail = (input: string) => {
    const trimmed = input.trim();
    if (trimmed.includes('@')) return trimmed;
    const cleanId = trimmed.replace(/[^a-zA-Z0-9.\-_+]/g, '');
    return `${cleanId}@teachermada.com`;
};

// Helper pour créer un profil DB
const createDefaultProfilePayload = (id: string, username: string, email: string, phone: string = "") => ({
    id: id,
    username: username,
    email: email,
    phone_number: phone,
    role: 'user',
    credits: 6, // Crédits de bienvenue (Serveur seulement)
    xp: 0,
    stats: { lessons_completed: 0, exercises_completed: 0, dialogues_completed: 0 },
    vocabulary: [],
    preferences: null,
    free_usage: { count: 0, lastResetWeek: new Date().toISOString() },
    ai_memory: {
        masteredVocabulary: [],
        frequentErrors: [],
        completedConcepts: [],
        currentDifficulties: [],
        lastLesson: "Introduction",
        weeklyGoal: "Découverte",
        successRate: 100,
        lastUpdate: Date.now()
    },
    is_suspended: false,
    created_at: new Date().toISOString()
});

export const storageService = {
  subscribeToSyncUpdates: (callback: SyncStatusListener) => {
      syncListeners.push(callback);
      callback(currentSyncStatus);
      return () => {
          syncListeners = syncListeners.filter(cb => cb !== callback);
      };
  },
  
  subscribeToUserUpdates: (callback: UserUpdateListener) => {
      userListeners.push(callback);
      return () => {
          userListeners = userListeners.filter(cb => cb !== callback);
      };
  },

  // --- AUTH ---
  
  login: async (id: string, pass: string): Promise<{success: boolean, user?: UserProfile, error?: string}> => {
    if (!isSupabaseConfigured()) return { success: false, error: "Supabase non configuré (Mode hors ligne)." };
    try {
        const email = formatLoginEmail(id);
        
        // 1. Auth Supabase
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
            email: email, 
            password: pass
        });

        if (authError) return { success: false, error: "Identifiants incorrects." };

        if (authData.user) {
            // 2. Fetch Profile (Strict : Pas de fallback local ici)
            let user = await storageService.getUserById(authData.user.id);
            
            // Retry logic si la DB est lente à répondre après création compte
            let attempts = 0;
            while (!user && attempts < 3) {
                await new Promise(resolve => setTimeout(resolve, 800));
                user = await storageService.getUserById(authData.user.id);
                attempts++;
            }
            
            // Si pas de profil, tentative de création (Self-healing)
            if (!user) {
                const username = authData.user.user_metadata?.username || id.split('@')[0];
                const phone = authData.user.user_metadata?.phone_number || "";
                const payload = createDefaultProfilePayload(authData.user.id, username, email, phone);
                
                const { error: insertError } = await supabase.from('profiles').insert([payload]);
                
                // Re-fetch après insertion
                if (!insertError) user = mapProfile(payload);
            }

            if (!user) return { success: false, error: "Impossible de charger le profil (Erreur Réseau/DB)." };
            if (user.isSuspended) return { success: false, error: "Compte suspendu par l'administrateur." };
            
            // 3. Sauvegarde locale SEULEMENT si succès DB
            storageService.saveLocalUser(user); 
            return { success: true, user };
        }
        return { success: false, error: "Erreur inconnue." };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
  },

  register: async (username: string, password?: string, email?: string, phoneNumber?: string): Promise<{success: boolean, user?: UserProfile, error?: string}> => {
    if (!isSupabaseConfigured()) return { success: false, error: "Supabase non configuré (Mode hors ligne)." };
    
    // Check Device Limit
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

        // Création explicite du profil
        const payload = createDefaultProfilePayload(authData.user.id, username.trim(), finalEmail, phoneNumber?.trim() || "");
        await supabase.from('profiles').insert([payload]);

        // Vérification
        const newUser = mapProfile(payload);
        storageService.saveLocalUser(newUser);
        
        // Increment Device Count
        localStorage.setItem('tm_device_accounts_count', (currentCount + 1).toString());
        
        return { success: true, user: newUser };

    } catch (e: any) {
        return { success: false, error: e.message };
    }
  },

  logout: async () => {
      try {
          await supabase.auth.signOut();
      } catch (e) {
          console.warn("Logout error (network):", e);
      }
      localStorage.removeItem(LOCAL_STORAGE_KEY);
      localStorage.removeItem('tm_v3_current_user_id'); 
  },

  // Récupère toujours la version la plus fraîche si en ligne
  getCurrentUser: async (): Promise<UserProfile | null> => {
      const localUser = storageService.getLocalUser();
      
      if (!isSupabaseConfigured()) return localUser;

      try {
          // 1. Check Auth Session
          const { data: { session }, error } = await supabase.auth.getSession();
          
          if (error) {
              // Handle Invalid Refresh Token specifically
              if (error.message && (error.message.includes("Invalid Refresh Token") || error.message.includes("Refresh Token Not Found"))) {
                  console.warn("Session expired (Invalid Refresh Token), clearing local data.");
                  await storageService.logout();
                  return null;
              }
              throw error;
          }

          if (session?.user) {
              // Si connecté, on force le fetch DB pour avoir les vrais crédits
              const dbUser = await storageService.getUserById(session.user.id);
              if (dbUser) {
                  // PROTECTION: Si la DB a perdu les préférences (ou pas encore sync), on garde celles en local
                  if (!dbUser.preferences && localUser?.preferences && localUser.id === dbUser.id) {
                      console.log("Restoring preferences from local storage");
                      dbUser.preferences = localUser.preferences;
                      // On tente de resynchroniser la DB en arrière-plan
                      storageService.saveUserProfile(dbUser);
                  }

                  storageService.saveLocalUser(dbUser); // Mise à jour cache
                  return dbUser;
              }
          }
      } catch (e) {
          console.warn("Supabase offline or not configured, falling back to local user.");
      }
      
      // Fallback local (Offline only)
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
      // Optimistic update for UI speed
      storageService.saveLocalUser(user); 
      
      if (!isSupabaseConfigured()) {
          notifySyncListeners('offline');
          return;
      }

      notifySyncListeners('syncing');
      try {
          // Background Sync
          const updates = {
              username: user.username,
              // Ne PAS envoyer les crédits ici pour éviter d'écraser la DB avec une vieille valeur locale
              xp: user.xp,
              lessons_completed: user.stats.lessonsCompleted,
              exercises_completed: user.stats.exercisesCompleted,
              dialogues_completed: user.stats.dialoguesCompleted,
              vocabulary: user.vocabulary,
              preferences: user.preferences,
              free_usage: user.freeUsage,
              ai_memory: user.aiMemory
          };

          await supabase.from('profiles').update(updates).eq('id', user.id);

          // Sync vocabulary to the new normalized table
          if (user.vocabulary && user.vocabulary.length > 0) {
              const vocabPayload = user.vocabulary.map(v => ({
                  user_id: user.id,
                  word: v.word,
                  translation: v.translation,
                  example: v.example || null,
                  mastered: v.mastered || false
              }));
              
              // We use upsert to avoid duplicate key errors (user_id, word)
              await supabase.from('user_vocabulary').upsert(vocabPayload, { onConflict: 'user_id, word' });
          }
          notifySyncListeners('synced');
      } catch (e) {
          console.warn("Sync error:", e);
          notifySyncListeners('error');
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

  // --- CREDITS (SECURE) ---

  canRequest: async (userId: string, minCredits: number = 1): Promise<boolean> => {
      // Always fetch fresh credits from DB to prevent PWA cache cheating
      const dbUser = await storageService.getUserById(userId);
      
      if (!dbUser) return false;
      
      // Sync local with fresh DB data
      storageService.saveLocalUser(dbUser);
      
      if (dbUser.role === 'admin') return true;
      if (dbUser.isSuspended) return false;
      
      return dbUser.credits >= minCredits;
  },

  consumeCredit: async (userId: string): Promise<boolean> => {
      return storageService.deductCredits(userId, 1);
  },

  deductCredits: async (userId: string, amount: number): Promise<boolean> => {
      if (!isSupabaseConfigured()) {
          // Local fallback for offline mode
          const local = storageService.getLocalUser();
          if (local && local.credits >= amount) {
              storageService.saveLocalUser({ ...local, credits: local.credits - amount });
              return true;
          }
          return false;
      }
      try {
          // Use Supabase RPC for atomic deduction
          const { data, error } = await supabase.rpc('consume_credits', {
              p_user_id: userId,
              p_amount: amount
          });

          if (error) {
              console.warn("RPC consume_credits failed:", error);
              return false;
          }

          if (data === true) {
              const local = storageService.getLocalUser();
              if (local) storageService.saveLocalUser({ ...local, credits: Math.max(0, local.credits - amount) });
              return true;
          } else {
              // Insufficient funds
              return false;
          }
      } catch (e) {
          console.warn("Error deducting credits:", e);
          return false;
      }
  },

  addCredits: async (userId: string, amount: number): Promise<boolean> => {
      if (!isSupabaseConfigured()) return false;
      try {
          const { error } = await supabase.rpc('add_credits', {
              p_user_id: userId,
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
          // Local Save
          const localKey = `tm_exam_${result.id}`;
          localStorage.setItem(localKey, JSON.stringify(result));

          if (!isSupabaseConfigured()) return;

          // DB Sync
          await supabase.from('exam_results').insert([{
              id: result.id,
              user_id: result.userId,
              language: result.language,
              level: result.level,
              score: result.score,
              total_questions: result.totalQuestions,
              passed: result.passed,
              details: result.details,
              created_at: new Date(result.date).toISOString()
          }]);
      } catch (e) {
          console.warn("Exam save error:", e);
      }
  },

  getExamResults: async (userId: string): Promise<ExamResult[]> => {
      let results: ExamResult[] = [];

      // 1. Try Supabase
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

      // 2. If Supabase failed or returned nothing, OR if we want to merge/ensure local exists
      // For simplicity/robustness: If Supabase worked, we trust it. If it failed (results empty and error caught), we try local.
      // However, to be truly robust (offline first or sync), we might want to merge. 
      // But here, let's just ensure if Supabase fails/is empty, we check local.
      
      if (results.length === 0) {
           const keys = Object.keys(localStorage).filter(k => k.startsWith('tm_exam_'));
           const localResults = keys.map(k => JSON.parse(localStorage.getItem(k) || '{}')).filter((r: ExamResult) => r.userId === userId);
           
           // Sort local by date desc
           localResults.sort((a, b) => b.date - a.date);
           
           if (localResults.length > 0) {
               results = localResults;
           }
      }

      return results;
  },

  saveCertificate: async (cert: Certificate) => {
      try {
          // Local Save
          const localKey = `tm_cert_${cert.id}`;
          localStorage.setItem(localKey, JSON.stringify(cert));

          if (!isSupabaseConfigured()) return;

          // DB Sync
          await supabase.from('certificates').insert([{
              id: cert.id,
              user_id: cert.userId,
              user_name: cert.userName,
              user_full_name: cert.userFullName, // New field
              language: cert.language,
              level: cert.level,
              exam_id: cert.examId,
              issue_date: new Date(cert.issueDate).toISOString(),
              validation_hash: cert.validationHash,
              qr_code_data: cert.qrCodeData,
              score: cert.score,
              global_score: cert.globalScore,
              skill_scores: cert.skillScores
          }]);
      } catch (e) {
          console.warn("Certificate save error:", e);
      }
  },

  getCertificates: async (userId: string): Promise<Certificate[]> => {
      if (!isSupabaseConfigured()) {
          // Local fallback
          const keys = Object.keys(localStorage).filter(k => k.startsWith('tm_cert_'));
          return keys.map(k => JSON.parse(localStorage.getItem(k) || '{}')).filter(c => c.userId === userId);
      }
      try {
          const { data } = await supabase.from('certificates').select('*').eq('user_id', userId).order('issue_date', { ascending: false });
          return data ? data.map(d => ({
              id: d.id,
              userId: d.user_id,
              userName: d.user_name,
              userFullName: d.user_full_name, // New field
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
      // 1. Try Local Storage first (fastest, works offline for own certs)
      const local = localStorage.getItem(`tm_cert_${certId}`);
      if (local) return JSON.parse(local);

      // 2. Try Supabase (Public verification)
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
      // 1. Try DB
      if (isSupabaseConfigured()) {
          try {
              const { data } = await supabase
                  .from('notifications')
                  .select('*')
                  .eq('user_id', userId)
                  .order('created_at', { ascending: false })
                  .limit(50);
              
              if (data) {
                  return data.map(n => ({
                      id: n.id,
                      userId: n.user_id,
                      type: n.type,
                      title: n.title,
                      message: n.message,
                      read: n.read,
                      createdAt: new Date(n.created_at).getTime(),
                      data: n.data
                  }));
              }
          } catch (e) {
              // Fallback
          }
      }

      // 2. Local Storage Fallback
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

      // Local Save
      const userId = n.userId;
      const localKey = `tm_notifications_${userId}`;
      const local = JSON.parse(localStorage.getItem(localKey) || "[]");
      localStorage.setItem(localKey, JSON.stringify([newNotif, ...local].slice(0, 50)));

      // DB Save
      if (isSupabaseConfigured()) {
          try {
              await supabase.from('notifications').insert([{
                  id: newNotif.id,
                  user_id: newNotif.userId,
                  type: newNotif.type,
                  title: newNotif.title,
                  message: newNotif.message,
                  read: false,
                  data: newNotif.data,
                  created_at: new Date().toISOString()
              }]);
          } catch (e) {
              console.warn("Notification DB insert failed", e);
          }
      }
      
      return newNotif;
  },

  markNotificationRead: async (userId: string, notifId: string) => {
      // Local
      const localKey = `tm_notifications_${userId}`;
      const local = JSON.parse(localStorage.getItem(localKey) || "[]");
      const updated = local.map((n: SmartNotification) => n.id === notifId ? { ...n, read: true } : n);
      localStorage.setItem(localKey, JSON.stringify(updated));

      // DB
      if (isSupabaseConfigured()) {
          try {
              await supabase.from('notifications').update({ read: true }).eq('id', notifId);
          } catch {}
      }
  },

  markAllNotificationsRead: async (userId: string) => {
      // Local
      const localKey = `tm_notifications_${userId}`;
      const local = JSON.parse(localStorage.getItem(localKey) || "[]");
      const updated = local.map((n: SmartNotification) => ({ ...n, read: true }));
      localStorage.setItem(localKey, JSON.stringify(updated));

      // DB
      if (isSupabaseConfigured()) {
          try {
              await supabase.from('notifications').update({ read: true }).eq('user_id', userId);
          } catch {}
      }
  },

  deleteNotification: async (userId: string, notifId: string) => {
      // Local
      const localKey = `tm_notifications_${userId}`;
      const local = JSON.parse(localStorage.getItem(localKey) || "[]");
      const updated = local.filter((n: SmartNotification) => n.id !== notifId);
      localStorage.setItem(localKey, JSON.stringify(updated));

      // DB
      if (isSupabaseConfigured()) {
          try {
              await supabase.from('notifications').delete().eq('id', notifId);
          } catch {}
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
      localStorage.setItem(SUPPORT_QUOTA_KEY, JSON.stringify(data));
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
              
              // Notification
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
    const cleanMode = prefs.mode.replace(/\s/g, '_');

    // 1. Try Supabase
    if (isSupabaseConfigured()) {
        try {
            const { data } = await supabase.from('learning_sessions').select('*').eq('id', key).single();
            if (data) {
                const session: LearningSession = {
                    id: data.id,
                    messages: data.messages || [],
                    progress: data.progress || 0,
                    score: data.score || 0
                };
                localStorage.setItem(key, JSON.stringify(session)); // Sync local
                return session;
            }
        } catch (e) {
            // Not found or error, fallback to local
        }
    }

    // 2. Try Local Storage
    const localData = localStorage.getItem(key);
    if (localData) {
        const session = JSON.parse(localData);
        // Sync to Supabase in background
        if (isSupabaseConfigured()) {
            supabase.from('learning_sessions').upsert({
                id: key,
                user_id: userId,
                target_language: cleanLang,
                level: prefs.level,
                mode: cleanMode,
                messages: session.messages,
                progress: session.progress,
                score: session.score
            }).then();
        }
        return session;
    }

    // 3. Create New
    const newSession: LearningSession = { id: key, messages: [], progress: 0, score: 0 };
    await storageService.saveSession(newSession, userId, prefs);
    return newSession;
  },

  saveSession: async (session: LearningSession, userId?: string, prefs?: UserPreferences) => {
    localStorage.setItem(session.id, JSON.stringify(session));
    
    if (isSupabaseConfigured()) {
        notifySyncListeners('syncing');
        try {
            if (userId && prefs) {
                const cleanLang = prefs.targetLanguage.split(' ')[0];
                const cleanMode = prefs.mode.replace(/\s/g, '_');
                await supabase.from('learning_sessions').upsert({
                    id: session.id,
                    user_id: userId,
                    target_language: cleanLang,
                    level: prefs.level,
                    mode: cleanMode,
                    messages: session.messages,
                    progress: session.progress,
                    score: session.score
                });
            } else {
                await supabase.from('learning_sessions').update({
                    messages: session.messages,
                    progress: session.progress,
                    score: session.score
                }).eq('id', session.id);
            }
            notifySyncListeners('synced');
        } catch (e) {
            console.warn("Error saving session to Supabase:", e);
            notifySyncListeners('error');
        }
    } else {
        notifySyncListeners('offline');
    }
  },

  clearSession: (userId: string) => {
      // Clear all sessions for this user
      Object.keys(localStorage).forEach(key => {
          if (key.startsWith(`${SESSION_PREFIX}${userId}`)) {
              localStorage.removeItem(key);
          }
      });
  },

  getChatHistory: (lang: string): any[] => [],

  // --- ADMIN ---
  getAdminRequests: async (): Promise<AdminRequest[]> => {
      if (!isSupabaseConfigured()) return [];
      try {
          const { data } = await supabase.from('admin_requests').select('*').order('created_at', { ascending: false });
          // Map DB snake_case to CamelCase
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
          return { status: 'pending' }; // Fail silently but pretend pending
      }
  },

  resolveRequest: async (reqId: string, status: 'approved' | 'rejected') => {
      try {
          if (status === 'approved') {
              const { data: req } = await supabase.from('admin_requests').select('*').eq('id', reqId).single();
              if (req && req.type === 'credit' && req.amount) {
                  await storageService.addCredits(req.user_id, req.amount);
                  
                  // Notification
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

  // --- SETTINGS ---
  loadSystemSettings: async (): Promise<SystemSettings> => {
      if (!isSupabaseConfigured()) return storageService.getSystemSettings();
      try {
          const { data, error } = await supabase.from('system_settings').select('*').single();
          if (!error && data) {
              // Normalize data
              let normalizedCoupons: CouponCode[] = [];
              if (Array.isArray(data.valid_transaction_refs)) {
                  normalizedCoupons = data.valid_transaction_refs.map((r: any) => {
                      if (typeof r === 'string') {
                          try { return JSON.parse(r); } catch { return { code: r, amount: 0, createdAt: new Date().toISOString() }; }
                      }
                      return r;
                  }).filter((c: any) => c && c.code);
              }

              const settings: SystemSettings = {
                  apiKeys: data.api_keys || [],
                  activeModel: data.active_model || 'gemini-3-flash-preview',
                  creditPrice: data.credit_price || 50,
                  customLanguages: data.custom_languages || [],
                  validTransactionRefs: normalizedCoupons,
                  adminContact: data.admin_contact || { telma: "0349310268", airtel: "0333878420", orange: "0326979017" }
              };
              localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
              return settings;
          }
      } catch {}
      return storageService.getSystemSettings();
  },

  getSystemSettings: (): SystemSettings => {
      const local = localStorage.getItem(SETTINGS_KEY);
      if (local) return JSON.parse(local);
      return {
          apiKeys: [], activeModel: 'gemini-3-flash-preview', creditPrice: 50, customLanguages: [],
          validTransactionRefs: [], adminContact: { telma: "0349310268", airtel: "0333878420", orange: "0326979017" }
      };
  },

  updateSystemSettings: async (settings: SystemSettings): Promise<boolean> => {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      if (!isSupabaseConfigured()) return true;
      try {
          const payload = {
              id: 1,
              api_keys: settings.apiKeys, active_model: settings.activeModel, credit_price: settings.creditPrice,
              custom_languages: settings.customLanguages, valid_transaction_refs: settings.validTransactionRefs,
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
  },
  
  importData: async (file: File, currentUserId: string): Promise<boolean> => { 
      try {
          const text = await file.text();
          const data = JSON.parse(text);
          if (data.username && data.stats) {
              const updated = {
                  username: data.username, stats: data.stats, vocabulary: data.vocabulary, preferences: data.preferences
              };
              const { error } = await supabase.from('profiles').update(updated).eq('id', currentUserId);
              return !error;
          }
      } catch {}
      return false; 
  }
};
