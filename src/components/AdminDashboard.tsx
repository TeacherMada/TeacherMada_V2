
import React, { useState, useEffect } from 'react';
import { UserProfile, SystemSettings, AdminRequest } from '../types';
import { storageService } from '../services/storageService';
import { Users, CreditCard, Settings, Search, Save, Key, UserCheck, UserX, LogOut, ArrowLeft, MessageSquare, Check, X, Plus, Minus, Lock, CheckCircle, RefreshCw, MessageCircle, AlertTriangle, Globe, Banknote, Flag, Info, Shield, Loader2, Trash2 } from 'lucide-react';

interface AdminDashboardProps {
  currentUser: UserProfile;
  onLogout: () => void;
  onBack: () => void;
  isDarkMode: boolean;
  notify: (message: string, type: 'success' | 'error' | 'info') => void;
}

const AdminDashboard: React.FC<AdminDashboardProps> = ({ onLogout, onBack, notify }) => {
  const [activeTab, setActiveTab] = useState<'users' | 'requests' | 'settings' | 'languages'>('users');
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [requests, setRequests] = useState<AdminRequest[]>([]);
  const [search, setSearch] = useState('');
  const [settings, setSettings] = useState<SystemSettings>(storageService.getSystemSettings());
  const [isLoading, setIsLoading] = useState(false);
  
  const [newLangName, setNewLangName] = useState('');
  const [newLangFlag, setNewLangFlag] = useState('');
  
  // New State for Coupon Generation
  const [newTransactionRef, setNewTransactionRef] = useState('');
  const [couponAmount, setCouponAmount] = useState<number>(10);

  const [manualCreditInputs, setManualCreditInputs] = useState<Record<string, string>>({});
  const [passwordInputs, setPasswordInputs] = useState<Record<string, string>>({});

  useEffect(() => {
    refreshData();
  }, []);

  const refreshData = async () => {
    setIsLoading(true);
    try {
        // Trigger auto cleanup of old requests
        await storageService.cleanupOldRequests();

        // Fetch users and requests in parallel
        const [fetchedUsers, fetchedRequests, fetchedSettings] = await Promise.all([
            storageService.getAllUsers(),
            storageService.getAdminRequests(),
            storageService.loadSystemSettings()
        ]);
        
        setUsers(fetchedUsers || []);
        setRequests(fetchedRequests || []);
        setSettings(fetchedSettings);
    } catch (e) {
        notify("Erreur lors du chargement des données. Vérifiez la connexion.", 'error');
    } finally {
        setIsLoading(false);
    }
  };

  const handleManualCreditChange = (userId: string, val: string) => {
      setManualCreditInputs(prev => ({ ...prev, [userId]: val }));
  };

  const executeManualCredit = async (userId: string, multiplier: number) => {
      const val = parseInt(manualCreditInputs[userId] || '0');
      if (!isNaN(val) && val !== 0) {
          const finalAmt = val * multiplier;
          const success = await storageService.addCredits(userId, finalAmt);
          
          if (success) {
              setManualCreditInputs(prev => ({ ...prev, [userId]: '' })); 
              await refreshData();
              notify(`Crédits modifiés: ${finalAmt > 0 ? '+' : ''}${finalAmt}`, 'success');
          } else {
              notify("Échec de la mise à jour des crédits.", 'error');
          }
      }
  };

  const handlePasswordChange = (userId: string, val: string) => {
      setPasswordInputs(prev => ({ ...prev, [userId]: val }));
  };

  const saveNewPassword = async (user: UserProfile) => {
      const newPass = passwordInputs[user.id];
      if (newPass && newPass.trim().length > 0) {
          await storageService.saveUserProfile({ ...user, password: newPass });
          setPasswordInputs(prev => ({ ...prev, [user.id]: '' }));
          await refreshData();
          notify(`Mot de passe mis à jour pour ${user.username}.`, 'success');
      }
  };

  const toggleSuspend = async (user: UserProfile) => {
      const updated = { ...user, isSuspended: !user.isSuspended };
      await storageService.saveUserProfile(updated);
      await refreshData();
      notify(`Utilisateur ${updated.isSuspended ? 'suspendu' : 'réactivé'}.`, 'info');
  };

  const handleResolveRequest = async (reqId: string, status: 'approved' | 'rejected') => {
      await storageService.resolveRequest(reqId, status);
      await refreshData();
      notify(`Demande ${status === 'approved' ? 'approuvée (Crédits ajoutés)' : 'rejetée'}.`, 'success');
  };

  const saveSettings = async () => {
      const success = await storageService.updateSystemSettings(settings);
      if (success) {
          notify("Paramètres sauvegardés dans le Cloud.", 'success');
      } else {
          notify("Erreur lors de la sauvegarde. Vérifiez les permissions DB.", 'error');
      }
  };

  const handleAddLanguage = async () => {
      if (!newLangName.trim() || !newLangFlag.trim()) return;
      const code = `${newLangName} ${newLangFlag}`;
      const newLang = { code, baseName: newLangName, flag: newLangFlag };
      
      const updatedSettings = { ...settings, customLanguages: [...(settings.customLanguages || []), newLang] };
      setSettings(updatedSettings);
      
      const success = await storageService.updateSystemSettings(updatedSettings);
      if (success) {
          setNewLangName(''); setNewLangFlag('');
          notify(`Langue ajoutée : ${newLangName}`, 'success');
      } else {
          notify("Erreur serveur : Langue non sauvegardée.", 'error');
      }
  };

  const removeLanguage = async (code: string) => {
      const updatedSettings = { ...settings, customLanguages: (settings.customLanguages || []).filter(l => l.code !== code) };
      setSettings(updatedSettings);
      await storageService.updateSystemSettings(updatedSettings);
      notify("Langue supprimée.", 'info');
  };

  // --- COUPON MANAGEMENT ---
  const handleAddCoupon = async () => {
      // 1. Sanitize Input: Prevent users from pasting JSON or weird characters
      let rawCode = newTransactionRef.trim();
      
      // Basic sanitization
      if (rawCode.startsWith('{') || rawCode.includes('"') || rawCode.length > 30) {
          notify("Format invalide. Entrez un code simple (ex: PROMO10).", 'error');
          return;
      }

      if (!rawCode || couponAmount <= 0) {
          notify("Code et montant requis.", 'error');
          return;
      }
      
      const newCoupon = {
          code: rawCode.toUpperCase(),
          amount: couponAmount,
          createdAt: new Date().toISOString()
      };

      // Handle fallback if validTransactionRefs is undefined
      const currentRefs = settings.validTransactionRefs || [];

      // Prevent duplicate codes
      if (currentRefs.some(c => c.code === newCoupon.code)) {
          notify("Ce code existe déjà.", 'error');
          return;
      }

      const updatedSettings = { 
          ...settings, 
          validTransactionRefs: [...currentRefs, newCoupon] 
      };
      
      setSettings(updatedSettings);
      const success = await storageService.updateSystemSettings(updatedSettings);
      if (success) {
          setNewTransactionRef('');
          notify(`Coupon créé : ${newCoupon.code} (${newCoupon.amount} CRD)`, 'success');
      } else {
          notify("Erreur serveur : Coupon non sauvegardé.", 'error');
      }
  };

  const removeCoupon = async (codeToRemove: string) => {
      const updatedSettings = { 
          ...settings, 
          validTransactionRefs: (settings.validTransactionRefs || []).filter(c => c.code !== codeToRemove) 
      };
      setSettings(updatedSettings);
      await storageService.updateSystemSettings(updatedSettings);
      notify("Coupon supprimé.", 'info');
  };

  const filteredUsers = users.filter(u => u.username.toLowerCase().includes(search.toLowerCase()) || (u.email && u.email.toLowerCase().includes(search.toLowerCase())));

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-4 md:p-6 pb-20">
      <div className="max-w-7xl mx-auto">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 bg-white dark:bg-slate-900 p-6 rounded-3xl shadow-sm border border-slate-200 dark:border-white/5">
            <div className="flex items-center gap-4">
                <div className="p-4 bg-indigo-600 rounded-2xl text-white shadow-lg shadow-indigo-500/20">
                    <Shield className="w-8 h-8" />
                </div>
                <div>
                    <h1 className="text-2xl font-black tracking-tight">TeacherMada Admin</h1>
                    <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">Master Control Dashboard</p>
                </div>
            </div>
            <div className="flex gap-2 w-full md:w-auto">
                <button onClick={refreshData} className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl hover:bg-slate-100">
                    {isLoading ? <Loader2 className="w-5 h-5 text-indigo-500 animate-spin"/> : <RefreshCw className="w-5 h-5 text-indigo-500"/>}
                </button>
                <button onClick={onBack} className="flex-1 md:flex-none flex items-center justify-center gap-2 px-6 py-3 bg-slate-100 dark:bg-slate-800 rounded-xl font-bold transition-all hover:bg-slate-200">
                    Mode Chat
                </button>
                <button onClick={onLogout} className="flex-1 md:flex-none px-6 py-3 bg-red-500 text-white rounded-xl font-bold shadow-lg shadow-red-500/20">
                    Déconnexion
                </button>
            </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto scrollbar-hide pb-2">
            <Tab active={activeTab === 'users'} onClick={() => setActiveTab('users')} icon={<Users className="w-4 h-4"/>} label="Utilisateurs" />
            <Tab active={activeTab === 'requests'} onClick={() => setActiveTab('requests')} icon={<MessageSquare className="w-4 h-4"/>} label="Demandes" count={(requests || []).filter(r => r.status === 'pending').length} />
            <Tab active={activeTab === 'languages'} onClick={() => setActiveTab('languages')} icon={<Globe className="w-4 h-4"/>} label="Langues" />
            <Tab active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} icon={<Settings className="w-4 h-4"/>} label="Système" />
        </div>

        {/* USERS TAB */}
        {activeTab === 'users' && (
            <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-sm overflow-hidden border border-slate-200 dark:border-white/5">
                <div className="p-4 border-b border-slate-100 dark:border-white/5">
                    <div className="relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input type="text" placeholder="Rechercher un utilisateur..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-12 pr-4 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500" />
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-slate-50 dark:bg-slate-800/50 text-[10px] font-black uppercase text-slate-400">
                            <tr>
                                <th className="p-5">Utilisateur</th>
                                <th className="p-5">Crédits</th>
                                <th className="p-5">Modification</th>
                                <th className="p-5">Sécurité</th>
                                <th className="p-5 text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-white/5 text-sm">
                            {filteredUsers.map(user => (
                                <tr key={user.id} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                                    <td className="p-5">
                                        <div className="font-black text-slate-800 dark:text-white">{user.username}</div>
                                        <div className="text-[10px] text-slate-400 font-mono">{user.email || 'Pas d\'email'}</div>
                                    </td>
                                    <td className="p-5 font-black text-indigo-600 text-lg">{user.credits}</td>
                                    <td className="p-5">
                                        <div className="flex items-center gap-1">
                                            <input type="number" placeholder="0" value={manualCreditInputs[user.id] || ''} onChange={(e) => handleManualCreditChange(user.id, e.target.value)} className="w-16 p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent text-center font-bold" />
                                            <button onClick={() => executeManualCredit(user.id, 1)} className="p-2 bg-emerald-500 text-white rounded-lg"><Plus className="w-4 h-4"/></button>
                                            <button onClick={() => executeManualCredit(user.id, -1)} className="p-2 bg-red-500 text-white rounded-lg"><Minus className="w-4 h-4"/></button>
                                        </div>
                                    </td>
                                    <td className="p-5">
                                        <div className="flex items-center gap-1">
                                            <input type="text" placeholder="Pass" value={passwordInputs[user.id] || ''} onChange={(e) => handlePasswordChange(user.id, e.target.value)} className="w-24 p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent text-xs" />
                                            <button onClick={() => saveNewPassword(user)} className="p-2 bg-indigo-600 text-white rounded-lg"><Save className="w-4 h-4"/></button>
                                        </div>
                                    </td>
                                    <td className="p-5 text-right">
                                        <button onClick={() => toggleSuspend(user)} className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all ${user.isSuspended ? 'border-red-500 text-red-500 bg-red-50 dark:bg-red-900/10' : 'border-emerald-500 text-emerald-500 bg-emerald-50 dark:bg-emerald-900/10'}`}>
                                            {user.isSuspended ? 'Suspens' : 'Actif'}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        )}

        {/* REQUESTS & COUPONS TAB */}
        {activeTab === 'requests' && (
            <div className="space-y-8">
                 {/* Auto Validation refs */}
                 <div className="bg-white dark:bg-slate-900 p-6 rounded-[2rem] border border-emerald-100 dark:border-emerald-900/30 shadow-sm relative overflow-hidden">
                     <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-100 dark:bg-emerald-900/20 rounded-full blur-2xl -mr-16 -mt-16"></div>
                     
                     <div className="relative z-10">
                        <h3 className="font-black text-emerald-800 dark:text-emerald-400 mb-6 flex items-center gap-2 uppercase tracking-widest text-sm">
                            <Banknote className="w-5 h-5"/> Créer un Coupon (Code)
                        </h3>
                        <div className="flex flex-col md:flex-row gap-3 mb-8">
                            <div className="flex-[2]">
                                <label className="text-[10px] font-bold text-slate-400 uppercase ml-2 mb-1 block">Code à distribuer</label>
                                <input 
                                    type="text" 
                                    placeholder="Ex: PROMO2024" 
                                    value={newTransactionRef} 
                                    onChange={e => setNewTransactionRef(e.target.value)} 
                                    className="w-full p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-emerald-500 font-bold font-mono text-lg uppercase" 
                                />
                            </div>
                            <div className="flex-1">
                                <label className="text-[10px] font-bold text-slate-400 uppercase ml-2 mb-1 block">Valeur (Crédits)</label>
                                <input 
                                    type="number" 
                                    value={couponAmount} 
                                    onChange={e => setCouponAmount(Number(e.target.value))} 
                                    className="w-full p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-emerald-500 font-bold text-center text-lg"
                                />
                            </div>
                            <div className="flex items-end">
                                <button onClick={handleAddCoupon} className="h-[60px] px-8 bg-emerald-600 text-white font-black rounded-2xl shadow-lg shadow-emerald-600/20 hover:scale-105 transition-transform flex items-center justify-center gap-2">
                                    <Plus className="w-5 h-5"/> Créer
                                </button>
                            </div>
                        </div>
                        
                        <div>
                            <h4 className="text-xs font-bold text-slate-400 uppercase mb-3">Coupons Actifs ({settings.validTransactionRefs?.length || 0})</h4>
                            <div className="flex flex-wrap gap-3">
                                {settings.validTransactionRefs?.length === 0 && <span className="text-slate-400 text-sm italic">Aucun coupon actif.</span>}
                                {settings.validTransactionRefs?.map((ref, i) => (
                                    <div key={i} className="px-4 py-2 bg-white dark:bg-slate-800 rounded-xl flex items-center gap-3 text-sm font-bold shadow-sm border border-slate-100 dark:border-slate-700 group hover:border-emerald-200 transition-colors">
                                        <span className="font-mono text-slate-700 dark:text-slate-300">
                                            {/* Safe Render for potential bad data */}
                                            {(ref.code && typeof ref.code === 'string' && ref.code.length > 20) 
                                                ? ref.code.substring(0, 15) + '...' 
                                                : (ref.code || '???')}
                                        </span>
                                        <span className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded text-xs">{ref.amount} CRD</span>
                                        <button onClick={() => removeCoupon(ref.code)} className="text-slate-300 hover:text-red-500 transition-colors p-1 bg-slate-50 dark:bg-slate-700 rounded"><Trash2 className="w-3.5 h-3.5"/></button>
                                    </div>
                                ))}
                            </div>
                        </div>
                     </div>
                 </div>

                 <div className="space-y-4">
                    <div className="flex items-center justify-between ml-2">
                        <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400">Demandes de Rechargement</h3>
                        <span className="bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-xs font-bold px-2 py-1 rounded-lg">{requests?.filter(r => r.status === 'pending').length || 0} en attente</span>
                    </div>
                    
                    {(!requests || requests.length === 0) && (
                        <div className="text-center py-10 bg-white dark:bg-slate-900 rounded-3xl border border-dashed border-slate-200 dark:border-slate-800">
                            <p className="text-slate-400 text-sm">Aucune demande.</p>
                        </div>
                    )}

                    {requests?.map(req => (
                        <div key={req.id} className="bg-white dark:bg-slate-900 p-6 rounded-[2rem] shadow-sm border border-slate-200 dark:border-white/5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 group hover:border-indigo-500/20 transition-all">
                            <div className="flex-1 w-full">
                                <div className="flex flex-wrap items-center gap-3 mb-2">
                                    <span className="font-black text-lg text-slate-800 dark:text-white">{req.username}</span>
                                    <span className="text-[10px] font-black text-slate-400 bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-full uppercase tracking-tighter">{new Date(req.createdAt).toLocaleDateString()}</span>
                                    {req.status === 'pending' && <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>}
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${req.type === 'credit' ? 'bg-indigo-50 text-indigo-600 border-indigo-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                                        {req.type === 'password_reset' ? 'Reset MDP' : req.type}
                                    </span>
                                </div>
                                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 w-full">
                                    {req.amount && (
                                        <div className="flex items-center gap-1 text-indigo-600 dark:text-indigo-400 font-black bg-indigo-50 dark:bg-indigo-900/20 px-3 py-1.5 rounded-xl text-sm border border-indigo-100 dark:border-indigo-800 w-fit">
                                            <CreditCard className="w-3.5 h-3.5"/>
                                            {req.amount} CRD
                                        </div>
                                    )}
                                    {req.message && <div className="text-slate-500 dark:text-slate-400 italic text-sm border-l-2 border-slate-200 dark:border-slate-700 pl-3 break-words w-full sm:w-auto">"{req.message}"</div>}
                                </div>
                            </div>
                            <div className="flex gap-2 w-full md:w-auto mt-2 md:mt-0">
                                {req.status === 'pending' ? (
                                    <>
                                        <button onClick={() => handleResolveRequest(req.id, 'approved')} className="flex-1 md:flex-none px-6 py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl shadow-lg shadow-emerald-500/20 font-bold transition-all flex items-center justify-center gap-2">
                                            <CheckCircle className="w-5 h-5"/> Accepter
                                        </button>
                                        <button onClick={() => handleResolveRequest(req.id, 'rejected')} className="flex-1 md:flex-none px-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-red-500 hover:border-red-200 rounded-2xl transition-all font-bold flex items-center justify-center gap-2">
                                            <X className="w-5 h-5"/> Rejeter
                                        </button>
                                    </>
                                ) : (
                                    <span className={`w-full md:w-auto text-center px-5 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border ${req.status === 'approved' ? 'bg-emerald-50 border-emerald-100 text-emerald-600' : 'bg-slate-50 border-slate-200 text-slate-400'}`}>
                                        {req.status === 'approved' ? 'Validé' : 'Rejeté'}
                                    </span>
                                )}
                            </div>
                        </div>
                    ))}
                 </div>
            </div>
        )}

        {/* LANGUAGES TAB */}
        {activeTab === 'languages' && (
            <div className="bg-white dark:bg-slate-900 p-8 rounded-[2rem] shadow-sm border border-slate-200 dark:border-white/5">
                <h3 className="text-xl font-black mb-8">Gestion des Langues (Synchronisé Supabase)</h3>
                <div className="flex flex-col md:flex-row gap-4 mb-10 bg-slate-50 dark:bg-slate-800 p-6 rounded-3xl">
                    <div className="flex-1 space-y-1">
                        <label className="text-[10px] font-bold uppercase text-slate-400 pl-2">Nom de la langue</label>
                        <input type="text" placeholder="ex: Italien" value={newLangName} onChange={e => setNewLangName(e.target.value)} className="w-full p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold outline-none focus:ring-2 focus:ring-indigo-500" />
                    </div>
                    <div className="w-full md:w-32 space-y-1">
                        <label className="text-[10px] font-bold uppercase text-slate-400 pl-2">Drapeau</label>
                        <input type="text" placeholder="ex: 🇮🇹" value={newLangFlag} onChange={e => setNewLangFlag(e.target.value)} className="w-full p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-center text-2xl outline-none focus:ring-2 focus:ring-indigo-500" />
                    </div>
                    <div className="flex items-end">
                        <button onClick={handleAddLanguage} className="w-full md:w-auto px-10 py-4 bg-indigo-600 text-white font-black rounded-2xl shadow-xl shadow-indigo-600/20 hover:scale-105 transition-transform">Ajouter</button>
                    </div>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {settings.customLanguages?.map(lang => (
                        <div key={lang.code} className="p-5 bg-white dark:bg-slate-900 rounded-[1.5rem] flex justify-between items-center border border-slate-100 dark:border-slate-800 shadow-sm transition-all hover:border-indigo-500/30">
                            <div className="flex items-center gap-4">
                                <span className="text-4xl shadow-sm p-2 bg-slate-50 dark:bg-slate-800 rounded-xl">{lang.flag}</span>
                                <div>
                                    <span className="font-black text-lg text-slate-800 dark:text-white block">{lang.baseName}</span>
                                    <span className="text-[10px] text-slate-400 uppercase tracking-wider">Custom</span>
                                </div>
                            </div>
                            <button onClick={() => removeLanguage(lang.code)} className="text-slate-300 hover:text-red-500 transition-colors p-2 hover:bg-red-50 rounded-xl"><X className="w-5 h-5"/></button>
                        </div>
                    ))}
                </div>
            </div>
        )}

        {/* SETTINGS TAB */}
        {activeTab === 'settings' && (
            <div className="bg-white dark:bg-slate-900 p-8 rounded-[2rem] shadow-sm border border-slate-200 dark:border-white/5">
                <h3 className="text-xl font-black mb-8">Paramètres Plateforme</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-10">
                    <div className="space-y-3">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block ml-2">Prix par Crédit (Ar)</label>
                        <input type="number" value={settings.creditPrice} onChange={e => setSettings({...settings, creditPrice: parseInt(e.target.value)})} className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-black text-xl border border-transparent focus:ring-2 focus:ring-indigo-500 outline-none" />
                    </div>
                    <div className="space-y-3">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block ml-2">Contact Telma</label>
                        <input type="text" value={settings.adminContact.telma} onChange={e => setSettings({...settings, adminContact: {...settings.adminContact, telma: e.target.value}})} className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-black text-xl border border-transparent focus:ring-2 focus:ring-indigo-500 outline-none" />
                    </div>
                    <div className="space-y-3">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block ml-2">Contact Airtel</label>
                        <input type="text" value={settings.adminContact.airtel} onChange={e => setSettings({...settings, adminContact: {...settings.adminContact, airtel: e.target.value}})} className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-black text-xl border border-transparent focus:ring-2 focus:ring-indigo-500 outline-none" />
                    </div>
                </div>
                <button onClick={saveSettings} className="w-full py-5 bg-indigo-600 text-white font-black rounded-2xl shadow-xl shadow-indigo-600/20 flex items-center justify-center gap-3 transition-transform active:scale-[0.99]">
                    <Save className="w-6 h-6"/> Sauvegarder les changements
                </button>
                <div className="mt-10 p-8 bg-amber-50 dark:bg-amber-900/10 border-l-8 border-amber-400 rounded-2xl">
                    <div className="flex items-center gap-3 text-amber-800 dark:text-amber-200 font-black mb-3"><Info className="w-6 h-6"/> Gestion API</div>
                    <p className="text-sm text-amber-700 dark:text-amber-400 leading-relaxed font-medium">Les clés API sont désormais isolées au niveau du déploiement (Render/Vercel) via la variable <strong>API_KEY</strong> pour une sécurité maximale. Pour changer de clé, mettez à jour votre environnement sur Render.</p>
                </div>
            </div>
        )}

      </div>
    </div>
  );
};

const Tab = ({ active, onClick, icon, label, count }: any) => (
    <button onClick={onClick} className={`flex items-center gap-3 px-8 py-4 rounded-2xl font-black whitespace-nowrap transition-all ${active ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-600/20' : 'bg-white dark:bg-slate-900 text-slate-500 border border-slate-200 dark:border-white/5'}`}>
        {icon} {label} {count !== undefined && count > 0 && <span className="bg-white/30 px-2 py-0.5 rounded-full text-[10px]">{count}</span>}
    </button>
);

export default AdminDashboard;
