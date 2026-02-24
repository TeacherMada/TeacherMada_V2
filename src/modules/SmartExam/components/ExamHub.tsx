
import React, { useState } from 'react';
import { UserProfile } from '../../../types';
import { SmartExam, ExamResultDetailed, ExamType } from '../types';
import { SmartExamService } from '../SmartExamService';
import { creditService, CREDIT_COSTS } from '../../../services/creditService';
import { Loader2, ShieldCheck, FileText, AlertTriangle, CheckCircle, XCircle, Clock, Award, Lock } from 'lucide-react';
import ExamRunner from './ExamRunner';
import ExamResult from './ExamResult';

interface Props {
    user: UserProfile;
    onClose: () => void;
    onUpdateUser: (u: UserProfile) => void;
    onShowPayment: () => void;
}

const ExamHub: React.FC<Props> = ({ user, onClose, onUpdateUser, onShowPayment }) => {
    if (!user) return null;
    const [view, setView] = useState<'hub' | 'runner' | 'result'>('hub');
    const [loading, setLoading] = useState(false);
    const [currentExam, setCurrentExam] = useState<SmartExam | null>(null);
    const [result, setResult] = useState<ExamResultDetailed | null>(null);
    const [pendingExamType, setPendingExamType] = useState<ExamType | null>(null);

    const handleStart = async (type: ExamType) => {
        const cost = type === 'certification' ? CREDIT_COSTS.EXAM : CREDIT_COSTS.DIAGNOSTIC;
        
        const hasBalance = await creditService.checkBalance(user.id, cost);
        if (!hasBalance) {
            onShowPayment();
            return;
        }

        // Removed native confirm to avoid UI blocking issues, relying on explicit action
        
        setLoading(true);
        try {
            const exam = await SmartExamService.startExam(user, type);
            
            if (exam && exam.sections && exam.sections.length > 0) {
                // Update local credits immediately
                // Note: SmartExamService.startExam already deducted credits via creditService
                // We just update the UI state here
                const updatedUser = { ...user, credits: user.credits - cost };
                onUpdateUser(updatedUser);
                setCurrentExam(exam);
                setView('runner');
            } else {
                alert("Erreur: Impossible de générer l'examen. Veuillez réessayer.");
            }
        } catch (e) {
            console.error(e);
            alert("Erreur de connexion au service d'examen.");
        } finally {
            setLoading(false);
        }
    };

    const handleFinishExam = async (answers: Record<string, string>) => {
        if (!currentExam || loading) return;
        setLoading(true);
        try {
            const res = await SmartExamService.evaluateExam(currentExam, answers, user);
            setResult(res);
            setView('result');
        } catch (e) {
            alert("Erreur lors de la correction. Veuillez réessayer.");
        } finally {
            setLoading(false);
        }
    };

    const requestStart = (type: ExamType) => {
        const cost = type === 'certification' ? CREDIT_COSTS.EXAM : CREDIT_COSTS.DIAGNOSTIC;
        if (user.credits < cost) {
            onShowPayment();
            return;
        }
        setPendingExamType(type);
    };

    if (loading) {
        return (
            <div className="fixed inset-0 z-[100] bg-white dark:bg-slate-950 flex flex-col items-center justify-center">
                <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mb-4" />
                <p className="text-lg font-bold text-slate-700 dark:text-slate-300">TeacherMada travaille...</p>
                <p className="text-sm text-slate-500">Préparation de l'environnement d'examen sécurisé</p>
            </div>
        );
    }

    if (view === 'runner' && currentExam) {
        return <ExamRunner exam={currentExam} onFinish={handleFinishExam} onCancel={onClose} />;
    }

    if (view === 'result' && result) {
        return <ExamResult result={result} onClose={onClose} />;
    }

    return (
        <div className="fixed inset-0 z-[80] bg-slate-50 dark:bg-slate-950 overflow-y-auto animate-fade-in">
            <div className="max-w-4xl mx-auto p-6 min-h-screen flex flex-col">
                <div className="flex justify-between items-center mb-8">
                    <h1 className="text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">
                        <ShieldCheck className="w-8 h-8 text-indigo-600" />
                        Centre d'Examen
                    </h1>
                    <button onClick={onClose} className="p-2 bg-slate-200 dark:bg-slate-800 rounded-full hover:bg-slate-300 transition-colors">
                        <XCircle className="w-6 h-6 text-slate-500" />
                    </button>
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                    {/* Diagnostic Card */}
                    <div className="bg-white dark:bg-slate-900 rounded-3xl p-8 border-2 border-slate-100 dark:border-slate-800 hover:border-indigo-200 dark:hover:border-indigo-900 transition-all shadow-lg group relative overflow-hidden">
                        <div className="absolute top-0 right-0 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-xs font-bold px-3 py-1 rounded-bl-xl">
                            RECOMMANDÉ
                        </div>
                        <div className="w-16 h-16 bg-indigo-50 dark:bg-indigo-900/20 rounded-2xl flex items-center justify-center mb-6 text-indigo-600">
                            <FileText className="w-8 h-8" />
                        </div>
                        <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Diagnostic Complet</h2>
                        <p className="text-slate-500 dark:text-slate-400 text-sm mb-6 leading-relaxed">
                            Évaluez précisément votre niveau réel (CEFR) sans pression. Idéal pour connaître vos points forts et faibles.
                        </p>
                        <ul className="space-y-2 mb-8 text-sm text-slate-600 dark:text-slate-300">
                            <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-500"/> Analyse détaillée</li>
                            <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-500"/> Pas de certificat</li>
                            <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-500"/> Durée ~15 min</li>
                        </ul>
                        <button onClick={() => requestStart('diagnostic')} className={`w-full py-4 font-bold rounded-xl transition-all flex items-center justify-center gap-2 ${user.credits >= CREDIT_COSTS.DIAGNOSTIC ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white hover:bg-indigo-600 hover:text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 opacity-80'}`}>
                            {user.credits >= CREDIT_COSTS.DIAGNOSTIC ? 'Commencer' : <><Lock className="w-4 h-4"/> Verrouillé</>} ({CREDIT_COSTS.DIAGNOSTIC} Crédits)
                        </button>
                    </div>

                    {/* Certification Card */}
                    <div className="bg-gradient-to-br from-slate-900 to-slate-800 dark:from-[#0F1422] dark:to-[#1E293B] rounded-3xl p-8 border-2 border-slate-700 shadow-xl text-white relative overflow-hidden group">
                        <div className="absolute -right-10 -top-10 w-40 h-40 bg-indigo-500/20 rounded-full blur-3xl group-hover:bg-indigo-500/30 transition-colors"></div>
                        
                        <div className="w-16 h-16 bg-white/10 rounded-2xl flex items-center justify-center mb-6 text-yellow-400 backdrop-blur-sm border border-white/10 shadow-inner">
                            <Award className="w-8 h-8" />
                        </div>
                        <h2 className="text-xl font-bold mb-2">Certification Officielle</h2>
                        <p className="text-slate-300 text-sm mb-6 leading-relaxed">
                            Passez l'examen final pour valider votre niveau {user.preferences?.level}. Certificat professionnel vérifiable inclus si réussite.
                        </p>
                        <ul className="space-y-2 mb-8 text-sm text-slate-300">
                            <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-yellow-400"/> Certificat PDF + QR Code</li>
                            <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-yellow-400"/> Vérification et Téléchargeable</li>
                            <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-yellow-400"/> Seuil de réussite 70%</li>
                        </ul>
                        <button onClick={() => requestStart('certification')} className={`w-full py-4 font-bold rounded-xl transition-all flex items-center justify-center gap-2 border border-white/10 ${user.credits >= CREDIT_COSTS.EXAM ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:shadow-lg hover:scale-[1.02]' : 'bg-slate-700 text-slate-400 opacity-80'}`}>
                            {user.credits >= CREDIT_COSTS.EXAM ? "Passer l'Examen" : <><Lock className="w-4 h-4"/> Débloquer l'Examen</>} ({CREDIT_COSTS.EXAM} Crédits)
                        </button>
                    </div>
                </div>

                <div className="mt-8 p-4 bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/30 rounded-xl flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-800 dark:text-amber-200">
                        <strong>Note importante :</strong> Assurez-vous d'avoir une connexion stable. Tout abandon en cours d'examen ne donne pas lieu à un remboursement des crédits. Le certificat n'est délivré que si le score est supérieur au seuil requis.
                    </p>
                </div>
            </div>

            {/* Rules Modal */}
            {pendingExamType && (
                <div className="fixed inset-0 z-[110] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
                    <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-lg w-full p-8 shadow-2xl border border-slate-200 dark:border-slate-800 animate-slide-up">
                        <div className="w-16 h-16 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center mb-6 mx-auto">
                            <AlertTriangle className="w-8 h-8 text-amber-600 dark:text-amber-400" />
                        </div>
                        <h3 className="text-2xl font-black text-slate-900 dark:text-white mb-2 text-center">
                            Règlement de l'Examen
                        </h3>
                        <p className="text-center text-slate-500 dark:text-slate-400 text-sm mb-6">
                            Vous êtes sur le point de commencer un examen officiel TeacherMada. Veuillez lire attentivement les règles suivantes.
                        </p>
                        
                        <div className="space-y-4 text-sm text-slate-700 dark:text-slate-300 mb-8 bg-slate-50 dark:bg-slate-800/50 p-6 rounded-2xl border border-slate-100 dark:border-slate-800">
                            <div className="flex gap-3">
                                <Clock className="w-5 h-5 text-indigo-500 shrink-0" />
                                <div><strong>Durée stricte :</strong> L'examen dure exactement 15 minutes. Les réponses sont soumises automatiquement à la fin du temps imparti.</div>
                            </div>
                            <div className="flex gap-3">
                                <ShieldCheck className="w-5 h-5 text-indigo-500 shrink-0" />
                                <div><strong>Anti-triche actif :</strong> Le mode plein écran est obligatoire. Quitter l'onglet, fermer le plein écran ou utiliser le clic droit génère un avertissement.</div>
                            </div>
                            <div className="flex gap-3">
                                <XCircle className="w-5 h-5 text-red-500 shrink-0" />
                                <div><strong>Tolérance zéro :</strong> Au bout de 3 avertissements, l'examen est annulé immédiatement et définitivement.</div>
                            </div>
                            <div className="flex gap-3">
                                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
                                <div><strong>Crédits :</strong> {pendingExamType === 'certification' ? CREDIT_COSTS.EXAM : CREDIT_COSTS.DIAGNOSTIC} crédits seront déduits dès le lancement. Aucun remboursement en cas d'abandon ou d'annulation.</div>
                            </div>
                        </div>

                        <div className="flex gap-3 justify-end">
                            <button onClick={() => setPendingExamType(null)} className="flex-1 py-3 rounded-xl font-bold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
                                Refuser
                            </button>
                            <button onClick={() => { handleStart(pendingExamType); setPendingExamType(null); }} className="flex-1 py-3 rounded-xl font-bold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-500/30">
                                J'accepte et je commence
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ExamHub;
