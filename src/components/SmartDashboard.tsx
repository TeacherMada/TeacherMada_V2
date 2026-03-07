import React, { useState, useMemo, useEffect } from 'react';
import { UserProfile, ChatMessage, SmartNotification, VoiceName } from '../types';
import { X, LogOut, Sun, Moon, Book, Trophy, Loader2, Save, Globe, Download, ShieldCheck, Upload, CreditCard, Plus, AlertTriangle, MessageCircle, Phone, Brain, ArrowRight, Award, ChevronRight, User, Bell, Check, Trash2, Info, CheckCircle, XCircle, BarChart3, Lock, Mail, Smartphone } from 'lucide-react';
import { storageService } from '../services/storageService';
import { toast } from './Toaster';
import ExamResultView from '../modules/SmartExam/components/ExamResult';
import { ExamResultDetailed } from '../modules/SmartExam/types';
import { useTranslation } from '../contexts/LanguageContext';

interface Props {
  user: UserProfile;
  onClose: () => void;
  onUpdateUser: (u: UserProfile) => void;
  onLogout: () => void;
  isDarkMode: boolean;
  toggleTheme: () => void;
  messages: ChatMessage[];
  onOpenAdmin: () => void;
  onShowPayment: () => void;
  onStartPractice: () => void;
  onStartExercise: () => void;
  onStartVoice: () => void;
  onStartExam: () => void;
}

const SmartDashboard: React.FC<Props> = ({ 
    user, onClose, onLogout, isDarkMode, toggleTheme, onUpdateUser, 
    onOpenAdmin, onShowPayment, onStartPractice, onStartExercise, onStartVoice, onStartExam 
}) => {
  const { t, setLanguage } = useTranslation();
  const language = useTranslation().language;

  const [activeTab, setActiveTab] = useState<'menu' | 'edit' | 'certs' | 'notifs'>('menu');
  const [isImporting, setIsImporting] = useState(false);
  const [certificates, setCertificates] = useState<any[]>([]);
  const [examResults, setExamResults] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<SmartNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [selectedResult, setSelectedResult] = useState<ExamResultDetailed | null>(null);
  const [startWithCert, setStartWithCert] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Load Data
  useEffect(() => {
    if (!user) return;
    const loadData = async () => {
        const certs = await storageService.getCertificates(user.id);
        setCertificates(certs);
        const exams = await storageService.getExamResults(user.id);
        setExamResults(exams);
        const notifs = await storageService.getNotifications(user.id);
        setNotifications(notifs);
        setUnreadCount(notifs.filter(n => !n.read).length);
    };
    loadData();
  }, [user?.id, activeTab]);
  
  // ── Edit Profile State (préférences) ──────────────────────────────────────
  const [editName, setEditName] = useState(user?.username || '');
  const [editTeacherName, setEditTeacherName] = useState(user?.preferences?.teacherName || 'TeacherMada');
  const [editVoiceName, setEditVoiceName] = useState<VoiceName>(user?.preferences?.voiceName || 'Kore');

  // ── ✅ NOUVEAU : Edit Compte State ────────────────────────────────────────
  const [editEmail, setEditEmail] = useState(user?.email || '');
  const [editPhone, setEditPhone] = useState((user as any)?.phoneNumber || '');
  const [editCurrentPassword, setEditCurrentPassword] = useState('');
  const [editNewPassword, setEditNewPassword] = useState('');
  const [isSavingAccount, setIsSavingAccount] = useState(false);

  const isLowCredits = user?.credits < 2;

  // Combine Certificates and Passed Exams
  const displayCertificates = useMemo(() => {
    if (!user) return [];
    const enrichedCertificates = certificates.map((cert: any) => {
        const exam = examResults.find((e: any) => e.id === cert.examId);
        const details = exam?.details;
        return {
            ...cert,
            skillScores: cert.skillScores || details?.skillScores || { 
                reading: cert.globalScore || cert.score || 0, 
                writing: cert.globalScore || cert.score || 0, 
                listening: cert.globalScore || cert.score || 0, 
                speaking: cert.globalScore || cert.score || 0 
            },
            feedback: cert.feedback || details?.feedback || t('exam.passed'),
            globalScore: cert.globalScore || cert.score || details?.globalScore || 0
        };
    });
    const combined = [...enrichedCertificates];
    const passedExams = examResults.filter((exam: any) => 
        exam.passed && 
        !certificates.some((cert: any) => cert.examId === exam.id)
    );
    passedExams.forEach((exam: any) => {
        const details = exam.details || {};
        const score = exam.score || exam.globalScore || 0;
        combined.push({
            id: `temp-${exam.id}`,
            examId: exam.id,
            userId: user.id,
            userName: user.username,
            userFullName: user.username,
            language: exam.language,
            issueDate: exam.date,
            globalScore: score,
            skillScores: details.skillScores || { reading: score, writing: score, listening: score, speaking: score },
            level: exam.level || exam.detectedLevel,
            feedback: details.feedback || t('exam.passed'),
            isGenerated: false 
        });
    });
    return combined.sort((a, b) => new Date(b.issueDate).getTime() - new Date(a.issueDate).getTime());
  }, [certificates, examResults, user, t]);

  // ── Sauvegarder les préférences (nom affiché + voix) ──────────────────────
  const handleSaveProfile = async () => {
      if (!editName.trim()) return;
      const updated = { 
          ...user, 
          username: editName,
          preferences: {
              ...(user.preferences || {}),
              teacherName: editTeacherName.trim() || 'TeacherMada',
              voiceName: editVoiceName
          } as any
      };
      await storageService.saveUserProfile(updated);
      onUpdateUser(updated);
      toast.success(t('common.success'));
      setActiveTab('menu');
  };

  // ── ✅ NOUVEAU : Sauvegarder infos du compte (email/phone/password) ────────
  const handleSaveAccount = async () => {
      if (isSavingAccount) return;
      setIsSavingAccount(true);
      try {
          const updates: any = {};
          if (editEmail.trim() && editEmail.trim() !== (user.email || '')) {
              updates.email = editEmail.trim();
          }
          if (editPhone.trim() !== ((user as any).phoneNumber || '')) {
              updates.phoneNumber = editPhone.trim();
          }
          if (editNewPassword) {
              if (!editCurrentPassword) {
                  toast.error("Entrez votre mot de passe actuel.");
                  setIsSavingAccount(false);
                  return;
              }
              if (editNewPassword.length < 6) {
                  toast.error("Nouveau mot de passe : 6 caractères minimum.");
                  setIsSavingAccount(false);
                  return;
              }
              updates.newPassword = editNewPassword;
              updates.currentPassword = editCurrentPassword;
          }

          if (Object.keys(updates).length === 0) {
              toast.info("Aucune modification détectée.");
              setIsSavingAccount(false);
              return;
          }

          const result = await (storageService as any).updateAccountInfo(user.id, updates);
          if (result.success) {
              toast.success("Compte mis à jour avec succès !");
              if (updates.email) {
                  toast.info("Email : vérifiez votre boîte mail pour confirmer le changement.");
              }
              // Mettre à jour l'état local
              const updatedUser = { 
                  ...user, 
                  ...(updates.email && { email: updates.email }),
                  ...(updates.phoneNumber !== undefined && { phoneNumber: updates.phoneNumber }),
              };
              onUpdateUser(updatedUser);
              setEditCurrentPassword('');
              setEditNewPassword('');
          } else {
              toast.error(result.error || "Erreur lors de la mise à jour.");
          }
      } finally {
          setIsSavingAccount(false);
      }
  };

  const toggleExplanationLang = async () => {
      const next = language === 'fr' ? 'mg' : 'fr';
      setLanguage(next);
      toast.success(`${t('common.language')}: ${next === 'fr' ? 'Français' : 'Malagasy'}`);
  };

  const handleExport = () => {
      storageService.exportData(user);
      toast.success(t('dashboard.data_exported'));
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setIsImporting(true);
      const success = await storageService.importData(file, user.id);
      setIsImporting(false);
      if (success) {
          toast.success(t('dashboard.data_imported'));
          setTimeout(() => window.location.reload(), 1500);
      } else {
          toast.error(t('dashboard.invalid_file'));
      }
  };

  const handleMarkRead = async (id: string, e?: React.MouseEvent) => {
      e?.stopPropagation();
      await storageService.markNotificationRead(user.id, id);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
  };

  const handleMarkAllRead = async () => {
      await storageService.markAllNotificationsRead(user.id);
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      setUnreadCount(0);
  };

  const handleDeleteNotif = async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      await storageService.deleteNotification(user.id, id);
      setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const handleNotificationClick = (notif: SmartNotification) => {
      if (!notif.read) handleMarkRead(notif.id);
      if (notif.data?.certificateId || notif.data?.examId) {
          const examId = notif.data.examId || notif.data.certificateId;
          const exam = examResults.find(e => e.id === examId);
          if (exam) {
              const details = exam.details || {};
              const score = exam.score || 0;
              const detailedResult: ExamResultDetailed = {
                  id: exam.id,
                  userId: user.id,
                  language: exam.language,
                  level: exam.level,
                  globalScore: score,
                  passed: exam.passed,
                  date: exam.date,
                  feedback: details.feedback || '',
                  skillScores: details.skillScores || { reading: score, writing: score, listening: score, speaking: score },
                  detectedLevel: exam.level,
                  confidenceScore: 0
              };
              setStartWithCert(!!notif.data?.certificateId);
              setSelectedResult(detailedResult);
              handleMarkRead(notif.id);
          }
      }
  };

  const handleDeleteConversation = async () => {
      await storageService.clearSession(user.id);
      toast.success(t('dashboard.conv_deleted'));
      onClose();
      window.location.reload(); 
  };

  if (!user) return null;

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      
      {/* Drawer */}
      <div className="relative w-full max-w-sm h-full bg-white dark:bg-[#0F1422] shadow-2xl flex flex-col animate-slide-in-right border-l border-slate-200 dark:border-slate-800">
        
        {/* Profile Header */}
        <div className="px-5 pt-6 pb-4 bg-white dark:bg-[#0F1422] border-b border-slate-50 dark:border-slate-800/50">
            <div className="flex items-center justify-between gap-3">
                <div 
                    className={`relative shrink-0 ${user.role === 'admin' ? 'cursor-pointer hover:scale-105 transition-transform' : ''}`}
                    onClick={() => user.role === 'admin' && onOpenAdmin()}
                    title={user.role === 'admin' ? "Accéder au panneau Admin" : ""}
                >
                    <div className={`w-14 h-14 rounded-full p-0.5 shadow-md ${user.role === 'admin' ? 'bg-gradient-to-tr from-red-500 to-orange-500' : 'bg-gradient-to-tr from-indigo-500 to-purple-500'}`}>
                        <div className="w-full h-full rounded-full bg-white dark:bg-slate-900 overflow-hidden border-2 border-white dark:border-slate-900">
                             <img src={`https://api.dicebear.com/9.x/micah/svg?seed=${user.username}`} className="w-full h-full object-cover" alt={user.username} />
                        </div>
                    </div>
                    <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-emerald-500 border-2 border-white dark:border-slate-900 rounded-full flex items-center justify-center text-white shadow-sm">
                        <span className="text-[8px] font-black">{user.preferences?.level?.split(' ')[0] || 'A1'}</span>
                    </div>
                </div>

                <div className="flex-1 flex flex-col items-center text-center min-w-0 px-2">
                    <h2 className="text-base font-black text-slate-900 dark:text-white leading-tight truncate w-full">{user.username}</h2>
                    <div className="flex items-center gap-1.5 mt-1 text-[9px] font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-700">
                        <Globe className="w-3 h-3" />
                        <span className="uppercase truncate max-w-[120px]">{user.preferences?.targetLanguage}</span>
                    </div>
                </div>

                <div className="flex flex-col items-end gap-2 shrink-0">
                    <button onClick={onClose} className="p-2 bg-slate-100 dark:bg-slate-800 rounded-full text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
                        <X className="w-4 h-4" />
                    </button>
                    {user.role === 'admin' && (
                        <div className="bg-red-500 text-white text-[8px] font-black px-1.5 py-0.5 rounded-md shadow-sm flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3" /> {t('dashboard.master_badge')}
                        </div>
                    )}
                </div>
            </div>
        </div>

        {/* Tab Switcher */}
        <div className="px-6 mt-2 mb-4">
            <div className="flex p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
                <button 
                    onClick={() => setActiveTab('menu')} 
                    className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${activeTab === 'menu' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}
                >
                    <User className="w-3 h-3" /> {t('dashboard.menu') || 'Menu'}
                </button>
                <button 
                    onClick={() => setActiveTab('certs')} 
                    className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${activeTab === 'certs' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}
                >
                    <Trophy className="w-3 h-3" /> {t('dashboard.certs') || 'Diplômes'}
                </button>
                <button 
                    onClick={() => setActiveTab('notifs')} 
                    className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 relative ${activeTab === 'notifs' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}
                >
                    <Bell className="w-3 h-3" />
                    {unreadCount > 0 && (
                        <span className="absolute top-1 right-1 w-3.5 h-3.5 bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center">{unreadCount > 9 ? '9+' : unreadCount}</span>
                    )}
                    {t('dashboard.notifs') || 'Notifs'}
                </button>
            </div>
        </div>

        {/* Tab Content — Scrollable */}
        <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-4 no-scrollbar">
            <style>{`.no-scrollbar::-webkit-scrollbar{display:none}.no-scrollbar{-ms-overflow-style:none;scrollbar-width:none}`}</style>

            {/* ── MENU TAB ── */}
            {activeTab === 'menu' && (
                <div className="space-y-4 animate-fade-in">

                    {/* Credits Card */}
                    <div className={`relative rounded-3xl p-5 overflow-hidden text-white shadow-lg ${isLowCredits ? 'bg-gradient-to-br from-red-500 to-rose-600' : 'bg-gradient-to-br from-indigo-500 to-purple-600'}`}>
                        <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-10 -mt-10 blur-2xl"></div>
                        <div className="flex items-start justify-between relative z-10">
                            <div>
                                <p className="text-xs font-bold opacity-80 uppercase tracking-widest">{t('common.credits')}</p>
                                <p className="text-4xl font-black mt-1">{user.credits}</p>
                            </div>
                            <div className="p-3 bg-white/20 rounded-2xl backdrop-blur-sm">
                                {isLowCredits ? <AlertTriangle className="w-5 h-5 text-white" /> : <CreditCard className="w-5 h-5 text-white" />}
                            </div>
                        </div>
                        <div className="mt-5 relative z-10">
                            <button 
                                onClick={onShowPayment}
                                className={`w-full py-2.5 font-bold rounded-xl transition-colors flex items-center justify-center gap-2 shadow-lg text-sm ${isLowCredits ? 'bg-white text-red-600 hover:bg-red-50' : 'bg-white text-slate-900 hover:bg-slate-100'}`}
                            >
                                <Plus className="w-4 h-4" /> {t('common.recharge')}
                            </button>
                        </div>
                    </div>

                    {/* Stats Card */}
                    <div className="bg-white dark:bg-slate-800 rounded-3xl p-5 border border-slate-100 dark:border-slate-700 shadow-sm">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-xl text-indigo-600 dark:text-indigo-400">
                                <BarChart3 className="w-5 h-5" />
                            </div>
                            <div>
                                <h3 className="font-black text-slate-900 dark:text-white text-sm">{t('dashboard.stats')}</h3>
                                <p className="text-[10px] text-slate-500">{t('dashboard.progress')}</p>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl text-center border border-slate-100 dark:border-slate-800">
                                <div className="text-2xl font-black text-indigo-600 dark:text-indigo-400">{examResults.length}</div>
                                <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">{t('dashboard.exams') || 'Examens'}</div>
                            </div>
                            <div className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl text-center border border-slate-100 dark:border-slate-800">
                                <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{displayCertificates.length}</div>
                                <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">{t('dashboard.certs') || 'Diplômes'}</div>
                            </div>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 overflow-hidden shadow-sm">
                        <SettingsItem icon={<MessageCircle className="w-5 h-5 text-indigo-500"/>} title={t('dashboard.start_dialogue')} value={t('dashboard.practice_conversation') || 'Pratiquer une conversation'} onClick={onStartPractice} />
                        <SettingsItem icon={<Brain className="w-5 h-5 text-emerald-500"/>} title={t('dashboard.start_exercise')} value={t('dashboard.test_knowledge') || 'Tester vos connaissances'} onClick={onStartExercise} />
                        <SettingsItem icon={<Phone className="w-5 h-5 text-purple-500"/>} title={t('dashboard.start_voice')} value={t('dashboard.live_call') || 'Appel vocal en direct'} onClick={onStartVoice} />
                        <SettingsItem icon={<Trophy className="w-5 h-5 text-rose-500"/>} title={t('dashboard.start_exam')} value={t('dashboard.get_certified') || 'Obtenir une certification'} onClick={onStartExam} />
                    </div>

                    {/* Settings */}
                    <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 overflow-hidden shadow-sm">
                        <SettingsItem icon={<User className="w-5 h-5 text-slate-500"/>} title={t('dashboard.edit_profile') || 'Modifier le profil'} value={user.username} onClick={() => setActiveTab('edit')} />
                        <SettingsItem icon={isDarkMode ? <Sun className="w-5 h-5 text-amber-500"/> : <Moon className="w-5 h-5 text-slate-500"/>} title={t('dashboard.theme') || 'Thème'} value={isDarkMode ? 'Sombre' : 'Clair'} onClick={toggleTheme} />
                        <SettingsItem icon={<Globe className="w-5 h-5 text-cyan-500"/>} title={t('dashboard.explanation_lang') || 'Langue d\'explication'} value={language === 'fr' ? 'Français' : 'Malagasy'} onClick={toggleExplanationLang} />
                    </div>

                    {/* Data */}
                    <div className="bg-white dark:bg-slate-800 rounded-3xl p-5 border border-slate-100 dark:border-slate-700 shadow-sm space-y-3">
                        <h3 className="font-black text-xs text-slate-500 uppercase">{t('dashboard.data') || 'Données'}</h3>
                        <div className="grid grid-cols-2 gap-3">
                            <button onClick={handleExport} className="flex flex-col items-center justify-center gap-1 p-4 bg-slate-50 dark:bg-slate-900 rounded-2xl hover:bg-indigo-50 dark:hover:bg-indigo-900/20 border border-slate-100 dark:border-slate-700 group transition-colors">
                                <Download className="w-6 h-6 text-slate-400 group-hover:text-indigo-500 mb-1 transition-colors" />
                                <span className="font-bold text-xs text-slate-600 dark:text-slate-300">{t('dashboard.export')}</span>
                            </button>
                            <label className="flex flex-col items-center justify-center gap-1 p-4 bg-slate-50 dark:bg-slate-900 rounded-2xl hover:bg-indigo-50 dark:hover:bg-indigo-900/20 border border-slate-100 dark:border-slate-700 group cursor-pointer transition-colors">
                                {isImporting ? <Loader2 className="w-6 h-6 animate-spin text-indigo-500 mb-1"/> : <Upload className="w-6 h-6 text-slate-400 group-hover:text-indigo-500 mb-1 transition-colors" />}
                                <span className="font-bold text-xs text-slate-600 dark:text-slate-300">{t('dashboard.restore')}</span>
                                <input type="file" accept=".json" onChange={handleImport} className="hidden" disabled={isImporting} />
                            </label>
                        </div>

                        {showDeleteConfirm ? (
                            <div className="mt-2 p-4 bg-red-50 dark:bg-red-900/20 rounded-2xl border border-red-100 dark:border-red-900/50 animate-fade-in">
                                <div className="flex items-center gap-3 mb-3 text-red-600 dark:text-red-400">
                                    <AlertTriangle className="w-5 h-5" />
                                    <span className="font-bold text-sm">{t('dashboard.confirm_delete_conv')}</span>
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={() => setShowDeleteConfirm(false)} className="flex-1 py-2 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 transition-colors text-xs">
                                        {t('common.cancel')}
                                    </button>
                                    <button onClick={handleDeleteConversation} className="flex-1 py-2 bg-red-500 text-white font-bold rounded-xl hover:bg-red-600 transition-colors text-xs shadow-lg shadow-red-500/20">
                                        {t('common.confirm')}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <button onClick={() => setShowDeleteConfirm(true)} className="w-full py-3 mt-2 bg-red-50 dark:bg-red-900/10 text-red-500 font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-red-100 dark:hover:bg-red-900/20 transition-colors text-xs">
                                <Trash2 className="w-4 h-4" /> {t('dashboard.delete_conv')}
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* ── CERTS TAB ── */}
            {activeTab === 'certs' && (
                <div className="space-y-4 animate-fade-in">
                    <h3 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                        <Award className="w-5 h-5 text-yellow-500" /> {t('dashboard.certs') || 'Diplômes & Résultats'}
                    </h3>
                    {displayCertificates.length === 0 ? (
                        <div className="text-center py-12 text-slate-400">
                            <Trophy className="w-12 h-12 mx-auto mb-3 opacity-30" />
                            <p className="font-bold text-sm">{t('dashboard.no_certs') || 'Aucun diplôme pour l\'instant'}</p>
                            <p className="text-xs mt-1">{t('dashboard.pass_exam') || 'Passez un examen pour obtenir un certificat'}</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {displayCertificates.map((cert: any) => (
                                <div key={cert.id} className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700 shadow-sm">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-sm font-black text-slate-900 dark:text-white">{cert.language}</span>
                                                <span className="text-[10px] font-bold bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded-full">{cert.level}</span>
                                            </div>
                                            <p className="text-xs text-slate-500">{new Date(cert.issueDate).toLocaleDateString('fr-FR')}</p>
                                        </div>
                                        <div className="text-right">
                                            <div className={`text-2xl font-black ${cert.globalScore >= 70 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
                                                {Math.round(cert.globalScore)}<span className="text-xs text-slate-400">/100</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    {examResults.filter(e => !e.passed).length > 0 && (
                        <div className="space-y-2">
                            <h4 className="text-xs font-black text-slate-400 uppercase">{t('dashboard.failed_exams') || 'Examens non validés'}</h4>
                            {examResults.filter(e => !e.passed).map((exam: any) => (
                                <div key={exam.id} className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3 border border-slate-100 dark:border-slate-700 flex items-center justify-between">
                                    <div>
                                        <span className="text-xs font-bold text-slate-600 dark:text-slate-300">{exam.language} • {exam.level}</span>
                                        <p className="text-[10px] text-slate-400">{new Date(exam.date).toLocaleDateString('fr-FR')}</p>
                                    </div>
                                    <div className={`text-lg font-black text-slate-400`}>
                                        {Math.round(exam.score)}<span className="text-xs">/100</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* ── EDIT PROFILE TAB ── */}
            {activeTab === 'edit' && (
                <div className="space-y-6 animate-fade-in">
                    <button onClick={() => setActiveTab('menu')} className="text-xs font-bold text-slate-400 hover:text-indigo-500 flex items-center gap-1 mb-2">
                        <ChevronRight className="w-3 h-3 rotate-180"/> {t('dashboard.back_dashboard') || 'Retour'}
                    </button>
                    
                    {/* ── Section 1 : Préférences pédagogiques ── */}
                    <div className="space-y-4">
                        <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Préférences pédagogiques</p>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase ml-2">{t('dashboard.username') || 'Nom affiché'}</label>
                            <input 
                                type="text" 
                                value={editName} 
                                onChange={e => setEditName(e.target.value)} 
                                className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 font-bold border-transparent border focus:bg-white dark:focus:bg-slate-900 transition-all"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase ml-2">{t('dashboard.teacher_name') || 'Nom du Professeur'}</label>
                            <input 
                                type="text" 
                                value={editTeacherName} 
                                onChange={e => setEditTeacherName(e.target.value)} 
                                placeholder="TeacherMada"
                                className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 font-bold border-transparent border focus:bg-white dark:focus:bg-slate-900 transition-all"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase ml-2">{t('dashboard.voice_style') || 'Style de Voix'}</label>
                            <select 
                                value={editVoiceName} 
                                onChange={e => setEditVoiceName(e.target.value as VoiceName)} 
                                className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 font-bold border-transparent border focus:bg-white dark:focus:bg-slate-900 transition-all appearance-none"
                            >
                                <option value="Kore">Kore (Femme, Douce)</option>
                                <option value="Zephyr">Zephyr (Femme, Dynamique)</option>
                                <option value="Puck">Puck (Homme, Chaleureux)</option>
                                <option value="Charon">Charon (Homme, Grave)</option>
                                <option value="Fenrir">Fenrir (Homme, Énergique)</option>
                            </select>
                        </div>
                        <button onClick={handleSaveProfile} className="w-full py-4 bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold rounded-2xl flex items-center justify-center gap-2 shadow-lg hover:scale-[1.02] transition-transform">
                            <Save className="w-5 h-5"/> {t('dashboard.save_changes') || 'Sauvegarder'}
                        </button>
                    </div>

                    {/* ── Section 2 : Compte & Sécurité (NOUVEAU) ── */}
                    <div className="border-t border-slate-100 dark:border-slate-700 pt-5 space-y-4">
                        <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Compte &amp; Sécurité</p>

                        {/* Email */}
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase ml-2 flex items-center gap-1">
                                <Mail className="w-3 h-3"/> Email
                            </label>
                            <input 
                                type="email" 
                                value={editEmail} 
                                onChange={e => setEditEmail(e.target.value)}
                                placeholder="votre@email.com"
                                className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 font-medium border-transparent border focus:bg-white dark:focus:bg-slate-900 transition-all text-sm"
                            />
                        </div>

                        {/* Téléphone */}
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase ml-2 flex items-center gap-1">
                                <Smartphone className="w-3 h-3"/> {t('common.phone') || 'Téléphone'}
                            </label>
                            <input 
                                type="tel" 
                                value={editPhone} 
                                onChange={e => setEditPhone(e.target.value)}
                                placeholder="034 00 000 00"
                                className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 font-medium border-transparent border focus:bg-white dark:focus:bg-slate-900 transition-all text-sm"
                            />
                        </div>

                        {/* Mot de passe actuel */}
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase ml-2 flex items-center gap-1">
                                <Lock className="w-3 h-3"/> Mot de passe actuel
                            </label>
                            <input 
                                type="password" 
                                value={editCurrentPassword} 
                                onChange={e => setEditCurrentPassword(e.target.value)}
                                placeholder="Requis pour changer le mot de passe"
                                className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 font-medium border-transparent border focus:bg-white dark:focus:bg-slate-900 transition-all text-sm"
                            />
                        </div>

                        {/* Nouveau mot de passe */}
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase ml-2 flex items-center gap-1">
                                <Lock className="w-3 h-3"/> Nouveau mot de passe
                            </label>
                            <input 
                                type="password" 
                                value={editNewPassword} 
                                onChange={e => setEditNewPassword(e.target.value)}
                                placeholder="6 caractères minimum"
                                className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 font-medium border-transparent border focus:bg-white dark:focus:bg-slate-900 transition-all text-sm"
                            />
                        </div>

                        <button 
                            onClick={handleSaveAccount} 
                            disabled={isSavingAccount}
                            className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl flex items-center justify-center gap-2 shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isSavingAccount 
                                ? <Loader2 className="w-5 h-5 animate-spin"/> 
                                : <Save className="w-5 h-5"/>
                            }
                            Enregistrer les infos du compte
                        </button>

                        <p className="text-[10px] text-slate-400 text-center px-4">
                            Laissez les champs mot de passe vides si vous ne souhaitez pas le changer.
                            Un email de confirmation sera envoyé si vous changez votre adresse email.
                        </p>
                    </div>
                </div>
            )}

            {/* ── NOTIFS TAB ── */}
            {activeTab === 'notifs' && (
                <div className="space-y-4 animate-fade-in">
                    <div className="flex items-center justify-between mb-2">
                        <button onClick={() => setActiveTab('menu')} className="text-xs font-bold text-slate-400 hover:text-indigo-500 flex items-center gap-1">
                            <ChevronRight className="w-3 h-3 rotate-180"/> {t('dashboard.back') || 'Retour'}
                        </button>
                        {notifications.length > 0 && (
                            <button onClick={handleMarkAllRead} className="text-xs font-bold text-indigo-500 hover:text-indigo-600 flex items-center gap-1">
                                <Check className="w-3 h-3"/> {t('dashboard.read_all') || 'Tout lire'}
                            </button>
                        )}
                    </div>

                    <h3 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                        {t('dashboard.notifications') || 'Notifications'}
                        {unreadCount > 0 && <span className="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full">{unreadCount}</span>}
                    </h3>

                    {notifications.length === 0 ? (
                        <div className="text-center py-12 text-slate-400">
                            <Bell className="w-12 h-12 mx-auto mb-3 opacity-30" />
                            <p className="font-bold text-sm">{t('dashboard.no_notifs') || 'Aucune notification'}</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {notifications.map((notif) => (
                                <div 
                                    key={notif.id} 
                                    onClick={() => handleNotificationClick(notif)}
                                    className={`p-4 rounded-2xl border transition-all relative group ${
                                        notif.read 
                                            ? 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700 opacity-70' 
                                            : 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-100 dark:border-indigo-900/50 shadow-sm'
                                    } ${(notif.data?.certificateId || notif.data?.examId) ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/80' : ''}`}
                                >
                                    <div className="flex gap-3">
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                                            notif.type === 'credit' ? 'bg-emerald-100 text-emerald-600' :
                                            notif.type === 'admin' ? 'bg-blue-100 text-blue-600' :
                                            notif.type === 'achievement' ? 'bg-yellow-100 text-yellow-600' :
                                            notif.type === 'warning' ? 'bg-red-100 text-red-600' :
                                            'bg-slate-100 text-slate-600'
                                        }`}>
                                            {notif.type === 'credit' ? <CreditCard className="w-5 h-5"/> :
                                             notif.type === 'admin' ? <Info className="w-5 h-5"/> :
                                             notif.type === 'achievement' ? <Trophy className="w-5 h-5"/> :
                                             notif.type === 'warning' ? <AlertTriangle className="w-5 h-5"/> :
                                             <Bell className="w-5 h-5"/>}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-start justify-between gap-2">
                                                <p className="font-bold text-sm text-slate-900 dark:text-white leading-tight">{notif.title}</p>
                                                <button 
                                                    onClick={(e) => handleDeleteNotif(notif.id, e)}
                                                    className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-500 transition-all shrink-0"
                                                >
                                                    <X className="w-3 h-3"/>
                                                </button>
                                            </div>
                                            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{notif.message}</p>
                                            <p className="text-[10px] text-slate-400 mt-1">{new Date(notif.createdAt).toLocaleDateString('fr-FR')}</p>
                                            {(notif.data?.certificateId || notif.data?.examId) && (
                                                <div className="flex items-center gap-1 mt-2 text-[10px] font-bold text-indigo-500">
                                                    <ArrowRight className="w-3 h-3"/> Voir les détails
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    {!notif.read && (
                                        <div className="absolute top-3 right-3 w-2 h-2 bg-indigo-500 rounded-full"></div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>

        {/* Footer — Déconnexion */}
        <div className="p-6 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-[#0F1422] safe-bottom">
            <button 
                onClick={onLogout}
                className="w-full py-3 bg-red-50 dark:bg-red-900/10 text-red-500 font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-red-100 dark:hover:bg-red-900/20 transition-colors text-sm"
            >
                <LogOut className="w-4 h-4" /> {t('dashboard.logout')}
            </button>
        </div>
      </div>

      {/* Exam Result Modal */}
      {selectedResult && (
          <ExamResultView result={selectedResult} onClose={() => setSelectedResult(null)} initialShowCert={startWithCert} />
      )}
    </div>
  );
};

// Helper Component
interface SettingsItemProps {
    icon: React.ReactNode;
    title: string;
    value: string;
    onClick: () => void;
}

const SettingsItem = ({ icon, title, value, onClick }: SettingsItemProps) => (
    <button onClick={onClick} className="w-full flex items-center justify-between p-4 bg-transparent hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-2xl transition-colors group">
        <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center group-hover:scale-110 transition-transform">
                {icon}
            </div>
            <div className="text-left">
                <div className="font-bold text-sm text-slate-800 dark:text-white">{title}</div>
                <div className="text-[10px] text-slate-400">{value}</div>
            </div>
        </div>
        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-500 transition-colors" />
    </button>
);

export default SmartDashboard;
