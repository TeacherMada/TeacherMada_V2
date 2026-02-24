
import React from 'react';
import { ExamResultDetailed } from '../types';
import { CheckCircle, XCircle, Download, Share2, Award, ChevronRight, Target, TrendingUp, AlertTriangle } from 'lucide-react';
import CertificateView from './Certificate';

interface Props {
    result: ExamResultDetailed;
    onClose: () => void;
    initialShowCert?: boolean;
}

const ExamResult: React.FC<Props> = ({ result, onClose, initialShowCert = false }) => {
    const [showCert, setShowCert] = React.useState(initialShowCert && !!result.certificateId);

    if (showCert && result.certificateId) {
        return <CertificateView result={result} onClose={() => setShowCert(false)} />;
    }

    const formatFeedback = (text: string) => {
        if (!text) return null;
        // Replace literal "\n" or "/n" sequences with actual newlines if they exist as text
        const cleaned = text.replace(/\\n/g, '\n').replace(/\/n/g, '\n');
        return cleaned.split('\n').map((line, i) => (
            <React.Fragment key={i}>
                {line}
                <br />
            </React.Fragment>
        ));
    };

    return (
        <div className="fixed inset-0 z-[90] bg-slate-50 dark:bg-slate-950 overflow-y-auto animate-fade-in">
            <div className="max-w-3xl mx-auto p-6 min-h-screen flex flex-col items-center justify-center">
                
                <div className="bg-white dark:bg-slate-900 rounded-[2rem] shadow-2xl overflow-hidden w-full border border-slate-200 dark:border-slate-800">
                    {/* Header Banner */}
                    <div className={`p-8 text-center relative overflow-hidden ${result.passed ? 'bg-gradient-to-br from-emerald-600 to-teal-800' : 'bg-gradient-to-br from-slate-800 to-slate-900'}`}>
                        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -mr-32 -mt-32 blur-3xl"></div>
                        <div className="absolute bottom-0 left-0 w-64 h-64 bg-black/10 rounded-full -ml-32 -mb-32 blur-3xl"></div>
                        
                        <div className="relative z-10">
                            <div className="w-24 h-24 bg-white/10 rounded-full flex items-center justify-center mx-auto mb-6 backdrop-blur-md border border-white/20 shadow-xl">
                                {result.passed ? <Award className="w-12 h-12 text-yellow-400 drop-shadow-lg" /> : <AlertTriangle className="w-12 h-12 text-amber-400 drop-shadow-lg" />}
                            </div>
                            <h1 className="text-4xl font-black text-white mb-3 tracking-tight">
                                {result.passed ? "Félicitations !" : "Résultat de l'Examen"}
                            </h1>
                            <p className="text-white/90 font-medium text-lg max-w-lg mx-auto">
                                {result.passed ? "Vous avez validé cette certification avec succès." : "Le seuil de réussite n'a pas été atteint cette fois-ci."}
                            </p>
                        </div>
                    </div>

                    {/* Scores */}
                    <div className="p-8 md:p-12">
                        <div className="flex flex-col md:flex-row justify-center items-center gap-8 mb-12">
                            <div className="text-center relative">
                                <svg className="w-40 h-40 transform -rotate-90">
                                    <circle cx="80" cy="80" r="70" fill="transparent" stroke="currentColor" strokeWidth="8" className="text-slate-100 dark:text-slate-800" />
                                    <circle cx="80" cy="80" r="70" fill="transparent" stroke="currentColor" strokeWidth="8" strokeDasharray={440} strokeDashoffset={440 - (440 * result.globalScore) / 100} className={`${result.passed ? 'text-emerald-500' : 'text-amber-500'} transition-all duration-1000 ease-out`} />
                                </svg>
                                <div className="absolute inset-0 flex flex-col items-center justify-center">
                                    <div className="text-5xl font-black text-slate-900 dark:text-white tracking-tighter">{Math.round(result.globalScore)}</div>
                                    <div className="text-sm font-bold text-slate-400 uppercase tracking-widest">Score</div>
                                </div>
                            </div>
                            
                            <div className="flex flex-col gap-4">
                                <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-100 dark:border-slate-700 flex items-center gap-4">
                                    <div className="w-12 h-12 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-xl flex items-center justify-center shrink-0">
                                        <Target className="w-6 h-6" />
                                    </div>
                                    <div>
                                        <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Niveau Évalué</div>
                                        <div className="text-xl font-black text-slate-900 dark:text-white">{result.detectedLevel}</div>
                                    </div>
                                </div>
                                <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-100 dark:border-slate-700 flex items-center gap-4">
                                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${result.passed ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'}`}>
                                        <TrendingUp className="w-6 h-6" />
                                    </div>
                                    <div>
                                        <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Statut</div>
                                        <div className={`text-xl font-black ${result.passed ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                                            {result.passed ? "Admis" : "Non Admis"}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <h3 className="text-lg font-black text-slate-900 dark:text-white mb-6 flex items-center gap-2">
                            Détail des Compétences
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
                            {Object.entries(result.skillScores).map(([skill, score]) => {
                                const skillNames: Record<string, string> = {
                                    reading: "Compréhension Écrite",
                                    writing: "Expression Écrite",
                                    listening: "Compréhension Orale",
                                    speaking: "Expression Orale"
                                };
                                return (
                                    <div key={skill} className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow">
                                        <div className="flex justify-between items-end mb-3">
                                            <div className="text-sm text-slate-600 dark:text-slate-300 font-bold">{skillNames[skill] || skill}</div>
                                            <div className="text-2xl font-black text-indigo-600 dark:text-indigo-400">{score}%</div>
                                        </div>
                                        <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                                            <div className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full" style={{ width: `${score}%` }}></div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <div className={`p-6 md:p-8 rounded-3xl border mb-10 ${result.passed ? 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-100 dark:border-emerald-900/30' : 'bg-amber-50 dark:bg-amber-900/10 border-amber-100 dark:border-amber-900/30'}`}>
                            <div className="flex items-center gap-3 mb-4">
                                <img src="https://i.ibb.co/B2XmRwmJ/logo.png" className="w-10 h-10 rounded-full shadow-sm" />
                                <div>
                                    <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">Feedback de TeacherMada</h3>
                                    <p className="text-xs text-slate-500">Directeur Pédagogique</p>
                                </div>
                            </div>
                            <div className="text-slate-700 dark:text-slate-300 text-sm md:text-base leading-relaxed font-medium">
                                {formatFeedback(result.feedback)}
                            </div>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-4">
                            {result.passed && result.certificateId && (
                                <button onClick={() => setShowCert(true)} className="flex-1 py-4 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-black rounded-2xl shadow-xl shadow-emerald-500/20 transition-all flex items-center justify-center gap-3 hover:scale-[1.02] active:scale-95">
                                    <Award className="w-6 h-6" /> Obtenir mon Certificat
                                </button>
                            )}
                            <button onClick={onClose} className="flex-1 py-4 bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white font-bold rounded-2xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-all active:scale-95">
                                Retour au tableau de bord
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ExamResult;
