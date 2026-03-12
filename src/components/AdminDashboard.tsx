/**
 * AdminDashboard.tsx — TeacherMada v3 ENHANCED 
 * ─────────────────────────────────────────────
 * Nouvelles fonctionnalités :
 * ✅ Retrait de crédits (bouton -)
 * ✅ Réinitialisation mot de passe utilisateur
 * ✅ Suppression utilisateur (avec confirmation)
 * ✅ Suspension/Activation via RPC sécurisé
 * ✅ Modification username/email/phone
 * ✅ Crédits en temps réel via Supabase Realtime
 * ✅ Modal de confirmation pour actions critiques
 */

import React, { useState, useEffect, useCallback, memo } from 'react';
import {
  UserProfile, SystemSettings, AdminRequest
} from '../types';
import { storageService } from '../services/storageService';
import { supabase } from '../lib/supabase';
import {
  Users, CreditCard, Settings, Search, Save, MessageSquare,
  Plus, Minus, RefreshCw, Banknote, Shield, Loader2, Trash2,
  CheckCircle, X, Info, Key, Edit2, AlertTriangle, Eye, EyeOff,
  UserX, UserCheck, ChevronDown, ChevronUp
} from 'lucide-react';

interface AdminDashboardProps {
  currentUser: UserProfile;
  onLogout: () => void;
  onBack: () => void;
  isDarkMode: boolean;
  notify: (message: string, type: 'success' | 'error' | 'info') => void;
}

// ── Modale de confirmation pour actions critiques ────────────────────────────
interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({
  title, message, confirmLabel = "Confirmer", danger = false, onConfirm, onCancel
}) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-sm p-6 border border-slate-200 dark:border-slate-700">
      <div className={`p-3 rounded-xl w-fit mb-4 ${danger ? 'bg-red-100 dark:bg-red-900/30' : 'bg-amber-100 dark:bg-amber-900/30'}`}>
        <AlertTriangle className={`w-6 h-6 ${danger ? 'text-red-500' : 'text-amber-500'}`} />
      </div>
      <h3 className="text-lg font-black text-slate-900 dark:text-white mb-2">{title}</h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">{message}</p>
      <div className="flex gap-3">
        <button
          onClick={onCancel}
          className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl font-bold hover:bg-slate-200 transition-all"
        >
          Annuler
        </button>
        <button
          onClick={onConfirm}
          className={`flex-1 py-3 rounded-xl font-bold text-white transition-all ${danger ? 'bg-red-500 hover:bg-red-600' : 'bg-amber-500 hover:bg-amber-600'}`}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  </div>
);

// ── Modale d'édition utilisateur ─────────────────────────────────────────────
interface EditUserModalProps {
  user: UserProfile;
  onSave: (updates: { username?: string; email?: string; phoneNumber?: string }) => Promise<void>;
  onClose: () => void;
  isLoading: boolean;
}

const EditUserModal: React.FC<EditUserModalProps> = ({ user, onSave, onClose, isLoading }) => {
  const [username, setUsername]     = useState(user.username || '');
  const [email, setEmail]           = useState(user.email || '');
  const [phone, setPhone]           = useState(user.phoneNumber || '');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md p-6 border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
            <Edit2 className="w-5 h-5 text-indigo-500" />
            Modifier l'utilisateur
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1.5 ml-1">
              Nom d'utilisateur
            </label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full p-3 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1.5 ml-1">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full p-3 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1.5 ml-1">
              Téléphone
            </label>
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="+261..."
              className="w-full p-3 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
            />
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl font-bold"
          >
            Annuler
          </button>
          <button
            onClick={() => onSave({ username, email, phoneNumber: phone })}
            disabled={isLoading}
            className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Sauvegarder
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Ligne utilisateur ─────────────────────────────────────────────────────────
interface UserRowProps {
  user: UserProfile;
  onAddCredits:    (userId: string, amount: number) => Promise<void>;
  onDeductCredits: (userId: string, amount: number) => Promise<void>;
  onToggleSuspend: (user: UserProfile) => void;
  onDelete:        (user: UserProfile) => void;
  onResetPassword: (user: UserProfile) => void;
  onEdit:          (user: UserProfile) => void;
  creditInput:     string;
  onCreditInputChange: (userId: string, val: string) => void;
}

const UserRow: React.FC<UserRowProps> = ({
  user, onAddCredits, onDeductCredits, onToggleSuspend,
  onDelete, onResetPassword, onEdit, creditInput, onCreditInputChange
}) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`border-b border-slate-100 dark:border-white/5 transition-all ${user.isSuspended ? 'bg-red-50/30 dark:bg-red-950/10' : ''}`}>
      {/* Ligne principale */}
      <div className="flex items-center gap-3 p-4 hover:bg-slate-50 dark:hover:bg-white/3 transition-colors">
        {/* Avatar */}
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm shrink-0 ${
          user.role === 'admin' ? 'bg-indigo-100 text-indigo-600' :
          user.isSuspended ? 'bg-red-100 text-red-500' :
          'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
        }`}>
          {user.username.charAt(0).toUpperCase()}
        </div>

        {/* Infos */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-black text-slate-800 dark:text-white truncate">{user.username}</span>
            {user.role === 'admin' && (
              <span className="text-[9px] font-black bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400 px-2 py-0.5 rounded-full uppercase">Admin</span>
            )}
            {user.isSuspended && (
              <span className="text-[9px] font-black bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400 px-2 py-0.5 rounded-full uppercase">Suspendu</span>
            )}
          </div>
          <div className="text-[10px] text-slate-400 font-mono truncate">{user.email || 'Pas d\'email'}</div>
        </div>

        {/* Crédits */}
        <div className="flex items-center gap-1.5 bg-indigo-50 dark:bg-indigo-900/20 px-3 py-1.5 rounded-xl shrink-0">
          <CreditCard className="w-3.5 h-3.5 text-indigo-500" />
          <span className="font-black text-indigo-600 dark:text-indigo-400 text-sm">{user.credits}</span>
        </div>

        {/* Toggle expand */}
        <button
          onClick={() => setExpanded(e => !e)}
          className="p-2 rounded-xl text-slate-400 hover:text-indigo-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Panneau expandé */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-slate-100 dark:border-white/5 pt-3 space-y-3 bg-slate-50/50 dark:bg-slate-800/20">

          {/* Gestion des crédits */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest w-full mb-1">Crédits</span>
            <input
              type="number"
              min="1"
              placeholder="Montant"
              value={creditInput}
              onChange={e => onCreditInputChange(user.id, e.target.value)}
              className="w-24 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-center font-bold outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
            />
            <button
              onClick={() => onAddCredits(user.id, parseInt(creditInput) || 0)}
              disabled={!creditInput || parseInt(creditInput) <= 0}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white rounded-xl font-bold text-sm transition-all"
            >
              <Plus className="w-4 h-4" /> Ajouter
            </button>
            <button
              onClick={() => onDeductCredits(user.id, parseInt(creditInput) || 0)}
              disabled={!creditInput || parseInt(creditInput) <= 0}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white rounded-xl font-bold text-sm transition-all"
            >
              <Minus className="w-4 h-4" /> Retirer
            </button>
          </div>

          {/* Actions utilisateur */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest w-full mb-1">Actions</span>

            <button
              onClick={() => onEdit(user)}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-bold text-xs transition-all"
            >
              <Edit2 className="w-3.5 h-3.5" /> Modifier
            </button>

            <button
              onClick={() => onResetPassword(user)}
              disabled={!user.email}
              title={!user.email ? "Email requis pour reset MDP" : ""}
              className="flex items-center gap-1.5 px-3 py-2 bg-amber-100 dark:bg-amber-900/30 hover:bg-amber-200 dark:hover:bg-amber-900/50 disabled:opacity-40 text-amber-700 dark:text-amber-400 rounded-xl font-bold text-xs transition-all"
            >
              <Key className="w-3.5 h-3.5" /> Reset MDP
            </button>

            <button
              onClick={() => onToggleSuspend(user)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl font-bold text-xs transition-all ${
                user.isSuspended
                  ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
              }`}
            >
              {user.isSuspended
                ? <><UserCheck className="w-3.5 h-3.5" /> Activer</>
                : <><UserX className="w-3.5 h-3.5" /> Suspendre</>
              }
            </button>

            {user.role !== 'admin' && (
              <button
                onClick={() => onDelete(user)}
                className="flex items-center gap-1.5 px-3 py-2 bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400 rounded-xl font-bold text-xs transition-all ml-auto"
              >
                <Trash2 className="w-3.5 h-3.5" /> Supprimer
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Composant principal ──────────────────────────────────────────────────────
const AdminDashboard: React.FC<AdminDashboardProps> = ({ onLogout, onBack, notify }) => {
  const [activeTab, setActiveTab]   = useState<'users' | 'requests' | 'settings'>('users');
  const [users, setUsers]           = useState<UserProfile[]>([]);
  const [requests, setRequests]     = useState<AdminRequest[]>([]);
  const [search, setSearch]         = useState('');
  const [settings, setSettings]     = useState<SystemSettings>(storageService.getSystemSettings());
  const [isLoading, setIsLoading]   = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null); // userId en cours

  // Crédits manuels
  const [manualCreditInputs, setManualCreditInputs] = useState<Record<string, string>>({});

  // Coupons
  const [newCouponCode, setNewCouponCode]   = useState('');
  const [couponAmount, setCouponAmount]     = useState<number>(10);

  // Modales
  const [confirmModal, setConfirmModal]   = useState<{
    title: string; message: string; confirmLabel?: string;
    danger?: boolean; onConfirm: () => void;
  } | null>(null);

  const [editUser, setEditUser]           = useState<UserProfile | null>(null);
  const [isEditLoading, setIsEditLoading] = useState(false);

  // ── Realtime subscription (crédits en temps réel) ─────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel('admin:profiles')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, (payload) => {
        if (payload.new) {
          setUsers(prev => prev.map(u =>
            u.id === payload.new.id
              ? { ...u, credits: payload.new.credits, isSuspended: payload.new.is_suspended }
              : u
          ));
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // ── Chargement des données ─────────────────────────────────────────────────
  const refreshData = useCallback(async () => {
    setIsLoading(true);
    try {
      await storageService.cleanupOldRequests();
      const [fetchedUsers, fetchedRequests, fetchedSettings] = await Promise.all([
        storageService.getAllUsers(),
        storageService.getAdminRequests(),
        storageService.loadSystemSettings(),
      ]);
      setUsers(fetchedUsers || []);
      setRequests(fetchedRequests || []);
      setSettings(fetchedSettings);
    } catch {
      notify("Erreur lors du chargement. Vérifiez la connexion.", 'error');
    } finally {
      setIsLoading(false);
    }
  }, [notify]);

  useEffect(() => { refreshData(); }, [refreshData]);

  // ── Gestion des crédits ────────────────────────────────────────────────────
  const handleAddCredits = async (userId: string, amount: number) => {
    if (!amount || amount <= 0) { notify("Montant invalide.", 'error'); return; }
    setActionLoading(userId);
    try {
      const success = await storageService.addCredits(userId, amount);
      if (success) {
        setManualCreditInputs(prev => ({ ...prev, [userId]: '' }));
        notify(`✅ +${amount} crédits ajoutés.`, 'success');
        // Realtime mettra à jour automatiquement, refreshData si besoin
      } else {
        notify("Échec de l'ajout de crédits.", 'error');
      }
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeductCredits = async (userId: string, amount: number) => {
    if (!amount || amount <= 0) { notify("Montant invalide.", 'error'); return; }

    setConfirmModal({
      title:        "Retirer des crédits",
      message:      `Voulez-vous retirer ${amount} crédits à cet utilisateur ?`,
      confirmLabel: `Retirer ${amount} CRD`,
      danger:       false,
      onConfirm: async () => {
        setConfirmModal(null);
        setActionLoading(userId);
        try {
          const success = await storageService.adminDeductCredits(userId, amount);
          if (success) {
            setManualCreditInputs(prev => ({ ...prev, [userId]: '' }));
            notify(`✅ -${amount} crédits retirés.`, 'success');
          } else {
            notify("Échec du retrait de crédits.", 'error');
          }
        } finally {
          setActionLoading(null);
        }
      },
    });
  };

  // ── Suspension ────────────────────────────────────────────────────────────
  const handleToggleSuspend = (user: UserProfile) => {
    const suspend = !user.isSuspended;
    setConfirmModal({
      title:        suspend ? "Suspendre l'utilisateur" : "Réactiver l'utilisateur",
      message:      suspend
        ? `Voulez-vous suspendre ${user.username} ? Il ne pourra plus se connecter.`
        : `Voulez-vous réactiver ${user.username} ?`,
      confirmLabel: suspend ? "Suspendre" : "Réactiver",
      danger:       suspend,
      onConfirm: async () => {
        setConfirmModal(null);
        setActionLoading(user.id);
        try {
          const result = await storageService.adminToggleSuspend(user.id, suspend);
          if (result.success) {
            setUsers(prev => prev.map(u => u.id === user.id ? { ...u, isSuspended: suspend } : u));
            notify(`${suspend ? '🔒 Suspendu' : '✅ Réactivé'} : ${user.username}`, 'info');
          } else {
            notify(result.error || "Erreur lors de la modification.", 'error');
          }
        } finally {
          setActionLoading(null);
        }
      },
    });
  };

  // ── Suppression ───────────────────────────────────────────────────────────
  const handleDeleteUser = (user: UserProfile) => {
    setConfirmModal({
      title:        "Supprimer l'utilisateur",
      message:      `Cette action est irréversible. Voulez-vous vraiment supprimer "${user.username}" et toutes ses données ?`,
      confirmLabel: "Supprimer définitivement",
      danger:       true,
      onConfirm: async () => {
        setConfirmModal(null);
        setActionLoading(user.id);
        try {
          const result = await storageService.adminDeleteUser(user.id);
          if (result.success) {
            setUsers(prev => prev.filter(u => u.id !== user.id));
            notify(`🗑️ Utilisateur ${user.username} supprimé.`, 'info');
          } else {
            notify(result.error || "Impossible de supprimer l'utilisateur.", 'error');
          }
        } finally {
          setActionLoading(null);
        }
      },
    });
  };

  // ── Reset MDP ─────────────────────────────────────────────────────────────
  const handleResetPassword = (user: UserProfile) => {
    if (!user.email) { notify("Email requis pour réinitialiser le mot de passe.", 'error'); return; }
    setConfirmModal({
      title:        "Réinitialiser le mot de passe",
      message:      `Un email de réinitialisation sera envoyé à ${user.email}. L'utilisateur devra cliquer sur le lien reçu.`,
      confirmLabel: "Envoyer l'email",
      danger:       false,
      onConfirm: async () => {
        setConfirmModal(null);
        setActionLoading(user.id);
        try {
          const result = await storageService.adminResetUserPassword(user.email!);
          if (result.success) {
            notify(`📧 Email de réinitialisation envoyé à ${user.email}`, 'success');
          } else {
            notify(result.error || "Erreur lors de l'envoi.", 'error');
          }
        } finally {
          setActionLoading(null);
        }
      },
    });
  };

  // ── Modification utilisateur ───────────────────────────────────────────────
  const handleEditUser = async (updates: { username?: string; email?: string; phoneNumber?: string }) => {
    if (!editUser) return;
    setIsEditLoading(true);
    try {
      const result = await storageService.adminUpdateUser(editUser.id, updates);
      if (result.success) {
        setUsers(prev => prev.map(u => u.id === editUser.id ? {
          ...u,
          username:    updates.username    || u.username,
          email:       updates.email       || u.email,
          phoneNumber: updates.phoneNumber || u.phoneNumber,
        } : u));
        notify("✅ Utilisateur mis à jour.", 'success');
        setEditUser(null);
      } else {
        notify(result.error || "Erreur lors de la mise à jour.", 'error');
      }
    } finally {
      setIsEditLoading(false);
    }
  };

  // ── Résolution des demandes ────────────────────────────────────────────────
  const handleResolveRequest = async (reqId: string, status: 'approved' | 'rejected') => {
    await storageService.resolveRequest(reqId, status);
    await refreshData();
    notify(`Demande ${status === 'approved' ? 'approuvée ✅' : 'rejetée'}.`, 'success');
  };

  // ── Coupons ───────────────────────────────────────────────────────────────
  const handleAddCoupon = async () => {
    const rawCode = newCouponCode.trim();
    if (rawCode.startsWith('{') || rawCode.includes('"') || rawCode.length > 30) {
      notify("Format invalide.", 'error'); return;
    }
    if (!rawCode || couponAmount <= 0) { notify("Code et montant requis.", 'error'); return; }

    const newCoupon = { code: rawCode.toUpperCase(), amount: couponAmount, createdAt: new Date().toISOString() };
    const currentRefs = settings.validTransactionRefs || [];

    if (currentRefs.some(c => c.code === newCoupon.code)) {
      notify("Ce code existe déjà.", 'error'); return;
    }

    const updatedSettings = { ...settings, validTransactionRefs: [...currentRefs, newCoupon] };
    setSettings(updatedSettings);
    const success = await storageService.updateSystemSettings(updatedSettings);
    if (success) {
      setNewCouponCode('');
      notify(`🎟️ Coupon créé : ${newCoupon.code} (${newCoupon.amount} CRD)`, 'success');
    } else {
      notify("Erreur serveur : Coupon non sauvegardé.", 'error');
    }
  };

  const handleRemoveCoupon = async (code: string) => {
    const updatedSettings = {
      ...settings,
      validTransactionRefs: (settings.validTransactionRefs || []).filter(c => c.code !== code)
    };
    setSettings(updatedSettings);
    await storageService.updateSystemSettings(updatedSettings);
    notify("Coupon supprimé.", 'info');
  };

  const handleSaveSettings = async () => {
    const success = await storageService.updateSystemSettings(settings);
    notify(success ? "✅ Paramètres sauvegardés." : "Erreur lors de la sauvegarde.", success ? 'success' : 'error');
  };

  // ── Filtres ───────────────────────────────────────────────────────────────
  const filteredUsers = users.filter(u =>
    u.username.toLowerCase().includes(search.toLowerCase()) ||
    (u.email && u.email.toLowerCase().includes(search.toLowerCase()))
  );

  const pendingCount = (requests || []).filter(r => r.status === 'pending').length;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-4 md:p-6 pb-20">

      {/* Modales */}
      {confirmModal && (
        <ConfirmModal
          title={confirmModal.title}
          message={confirmModal.message}
          confirmLabel={confirmModal.confirmLabel}
          danger={confirmModal.danger}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}
      {editUser && (
        <EditUserModal
          user={editUser}
          onSave={handleEditUser}
          onClose={() => setEditUser(null)}
          isLoading={isEditLoading}
        />
      )}

      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 bg-white dark:bg-slate-900 p-6 rounded-3xl shadow-sm border border-slate-200 dark:border-white/5">
          <div className="flex items-center gap-4">
            <div className="p-4 bg-indigo-600 rounded-2xl text-white shadow-lg shadow-indigo-500/20">
              <Shield className="w-7 h-7" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight">TeacherMada Admin</h1>
              <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">Master Control Dashboard</p>
            </div>
          </div>
          <div className="flex gap-2 w-full md:w-auto">
            <button
              onClick={refreshData}
              className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl hover:bg-slate-100 transition-all"
              title="Actualiser"
            >
              {isLoading
                ? <Loader2 className="w-5 h-5 text-indigo-500 animate-spin" />
                : <RefreshCw className="w-5 h-5 text-indigo-500" />
              }
            </button>
            <button
              onClick={onBack}
              className="flex-1 md:flex-none px-5 py-3 bg-slate-100 dark:bg-slate-800 rounded-xl font-bold hover:bg-slate-200 transition-all"
            >
              Mode Chat
            </button>
            <button
              onClick={onLogout}
              className="flex-1 md:flex-none px-5 py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl font-bold shadow-lg shadow-red-500/20 transition-all"
            >
              Déconnexion
            </button>
          </div>
        </div>

        {/* Stats rapides */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-white/5 shadow-sm">
            <div className="text-2xl font-black text-indigo-600">{users.length}</div>
            <div className="text-xs text-slate-400 font-bold uppercase tracking-wider mt-1">Utilisateurs</div>
          </div>
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-white/5 shadow-sm">
            <div className="text-2xl font-black text-amber-500">{pendingCount}</div>
            <div className="text-xs text-slate-400 font-bold uppercase tracking-wider mt-1">Demandes</div>
          </div>
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-white/5 shadow-sm">
            <div className="text-2xl font-black text-red-500">{users.filter(u => u.isSuspended).length}</div>
            <div className="text-xs text-slate-400 font-bold uppercase tracking-wider mt-1">Suspendus</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
          {[
            { key: 'users',    icon: <Users className="w-4 h-4" />,         label: "Utilisateurs",  count: users.length },
            { key: 'requests', icon: <MessageSquare className="w-4 h-4" />, label: "Demandes",      count: pendingCount },
            { key: 'settings', icon: <Settings className="w-4 h-4" />,      label: "Système" },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={`flex items-center gap-2 px-6 py-3.5 rounded-2xl font-black whitespace-nowrap transition-all text-sm ${
                activeTab === tab.key
                  ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-600/20'
                  : 'bg-white dark:bg-slate-900 text-slate-500 border border-slate-200 dark:border-white/5 hover:border-indigo-300'
              }`}
            >
              {tab.icon}
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-black ${
                  activeTab === tab.key ? 'bg-white/20 text-white' : 'bg-indigo-100 text-indigo-600'
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── ONGLET UTILISATEURS ── */}
        {activeTab === 'users' && (
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-sm overflow-hidden border border-slate-200 dark:border-white/5">
            <div className="p-4 border-b border-slate-100 dark:border-white/5">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Rechercher par nom ou email..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-12 pr-4 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                />
              </div>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="text-center py-16 text-slate-400">
                <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="font-bold">Aucun utilisateur trouvé</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-white/5">
                {filteredUsers.map(user => (
                  <div key={user.id} className={actionLoading === user.id ? 'opacity-60 pointer-events-none' : ''}>
                    <UserRow
                      user={user}
                      creditInput={manualCreditInputs[user.id] || ''}
                      onCreditInputChange={(uid, val) => setManualCreditInputs(prev => ({ ...prev, [uid]: val }))}
                      onAddCredits={handleAddCredits}
                      onDeductCredits={handleDeductCredits}
                      onToggleSuspend={handleToggleSuspend}
                      onDelete={handleDeleteUser}
                      onResetPassword={handleResetPassword}
                      onEdit={setEditUser}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── ONGLET DEMANDES & COUPONS ── */}
        {activeTab === 'requests' && (
          <div className="space-y-6">

            {/* Créer un coupon */}
            <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-emerald-100 dark:border-emerald-900/30 shadow-sm">
              <h3 className="font-black text-emerald-700 dark:text-emerald-400 mb-5 flex items-center gap-2 text-sm uppercase tracking-widest">
                <Banknote className="w-5 h-5" /> Créer un Coupon
              </h3>
              <div className="flex flex-col md:flex-row gap-3 mb-5">
                <div className="flex-[2]">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1.5 ml-1">Code</label>
                  <input
                    type="text"
                    placeholder="Ex: PROMO2024"
                    value={newCouponCode}
                    onChange={e => setNewCouponCode(e.target.value.toUpperCase())}
                    className="w-full p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-emerald-500 font-bold font-mono text-lg uppercase"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1.5 ml-1">Crédits</label>
                  <input
                    type="number"
                    min="1"
                    value={couponAmount}
                    onChange={e => setCouponAmount(Number(e.target.value))}
                    className="w-full p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-emerald-500 font-bold text-center text-lg"
                  />
                </div>
                <div className="flex-1 flex flex-col justify-end">
                  <button
                    onClick={handleAddCoupon}
                    className="w-full p-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl font-black flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-500/20"
                  >
                    <Plus className="w-5 h-5" /> Créer
                  </button>
                </div>
              </div>

              {/* Liste des coupons actifs */}
              {(settings.validTransactionRefs || []).length > 0 && (
                <div className="space-y-2 mt-4">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Coupons actifs</p>
                  {(settings.validTransactionRefs || []).map(c => (
                    <div key={c.code} className="flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-800 rounded-xl">
                      <div>
                        <span className="font-black font-mono text-sm text-slate-800 dark:text-white">{c.code}</span>
                        <span className="ml-3 text-xs text-emerald-600 font-bold">{c.amount} CRD</span>
                      </div>
                      <button
                        onClick={() => handleRemoveCoupon(c.code)}
                        className="text-slate-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Demandes utilisateurs */}
            <div>
              <h3 className="font-black text-slate-800 dark:text-white mb-4 flex items-center gap-2 text-sm uppercase tracking-widest">
                <MessageSquare className="w-5 h-5 text-indigo-500" />
                Demandes ({pendingCount} en attente)
              </h3>
              <div className="space-y-3">
                {(!requests || requests.length === 0) ? (
                  <div className="text-center py-10 bg-white dark:bg-slate-900 rounded-3xl border border-dashed border-slate-200 dark:border-slate-800">
                    <p className="text-slate-400 font-bold text-sm">Aucune demande pour l'instant.</p>
                  </div>
                ) : requests.map(req => (
                  <div
                    key={req.id}
                    className="bg-white dark:bg-slate-900 p-5 rounded-2xl shadow-sm border border-slate-200 dark:border-white/5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4"
                  >
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <span className="font-black text-slate-800 dark:text-white">{req.username}</span>
                        <span className="text-[9px] font-black text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full uppercase">
                          {new Date(req.createdAt).toLocaleDateString('fr-FR')}
                        </span>
                        {req.status === 'pending' && <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />}
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded border uppercase ${
                          req.type === 'credit'
                            ? 'bg-indigo-50 text-indigo-600 border-indigo-200'
                            : 'bg-slate-50 text-slate-600 border-slate-200'
                        }`}>
                          {req.type === 'password_reset' ? 'Reset MDP' : req.type}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-3 items-center">
                        {req.amount && (
                          <span className="flex items-center gap-1 text-indigo-600 font-black bg-indigo-50 dark:bg-indigo-900/20 px-3 py-1.5 rounded-xl text-sm border border-indigo-100 dark:border-indigo-800">
                            <CreditCard className="w-3.5 h-3.5" /> {req.amount} CRD
                          </span>
                        )}
                        {req.message && (
                          <span className="text-slate-500 italic text-sm border-l-2 border-slate-200 pl-3">
                            "{req.message}"
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 w-full md:w-auto">
                      {req.status === 'pending' ? (
                        <>
                          <button
                            onClick={() => handleResolveRequest(req.id, 'approved')}
                            className="flex-1 md:flex-none px-5 py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20"
                          >
                            <CheckCircle className="w-4 h-4" /> Accepter
                          </button>
                          <button
                            onClick={() => handleResolveRequest(req.id, 'rejected')}
                            className="flex-1 md:flex-none px-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-red-500 hover:border-red-200 rounded-2xl font-bold flex items-center justify-center gap-2"
                          >
                            <X className="w-4 h-4" /> Rejeter
                          </button>
                        </>
                      ) : (
                        <span className={`text-center px-5 py-2 rounded-full text-[10px] font-black uppercase border ${
                          req.status === 'approved'
                            ? 'bg-emerald-50 border-emerald-100 text-emerald-600'
                            : 'bg-slate-50 border-slate-200 text-slate-400'
                        }`}>
                          {req.status === 'approved' ? 'Validé' : 'Rejeté'}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── ONGLET PARAMÈTRES ── */}
        {activeTab === 'settings' && (
          <div className="bg-white dark:bg-slate-900 p-8 rounded-3xl shadow-sm border border-slate-200 dark:border-white/5">
            <h3 className="text-xl font-black mb-8">Paramètres Plateforme</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
              {[
                { label: 'Prix par Crédit (Ar)', field: 'creditPrice', type: 'number', value: settings.creditPrice },
                { label: 'Contact Telma',        field: 'telma',       type: 'text',   value: settings.adminContact?.telma },
                { label: 'Contact Airtel',       field: 'airtel',      type: 'text',   value: settings.adminContact?.airtel },
                { label: 'Contact Orange',       field: 'orange',      type: 'text',   value: settings.adminContact?.orange },
              ].map(({ label, field, type, value }) => (
                <div key={field} className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block ml-1">{label}</label>
                  <input
                    type={type}
                    value={value || ''}
                    onChange={e => {
                      if (field === 'creditPrice') {
                        setSettings(s => ({ ...s, creditPrice: parseInt(e.target.value) || 0 }));
                      } else {
                        setSettings(s => ({
                          ...s,
                          adminContact: { ...(s.adminContact || { telma: '', airtel: '', orange: '' }), [field]: e.target.value }
                        }));
                      }
                    }}
                    className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold border border-transparent focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
              ))}
            </div>
            <button
              onClick={handleSaveSettings}
              className="w-full py-5 bg-indigo-600 hover:bg-indigo-700 text-white font-black rounded-2xl shadow-xl shadow-indigo-600/20 flex items-center justify-center gap-3 transition-all"
            >
              <Save className="w-5 h-5" /> Sauvegarder les changements
            </button>

            <div className="mt-8 p-6 bg-amber-50 dark:bg-amber-900/10 border-l-4 border-amber-400 rounded-2xl">
              <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200 font-black mb-2">
                <Info className="w-5 h-5" /> Gestion API
              </div>
              <p className="text-sm text-amber-700 dark:text-amber-400 leading-relaxed">
                Les clés API sont configurées via les variables d'environnement sur Render/Vercel (<code>API_KEY</code>). 
                Pour changer de clé, mettez à jour l'environnement de déploiement.
              </p>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default memo(AdminDashboard);
