import React, { useEffect, useState } from 'react';
import { Certificate } from '../types';
import { storageService } from '../services/storageService';
import { CheckCircle, XCircle, Loader2, Award, Calendar, User, Globe } from 'lucide-react';

interface Props {
    certId: string;
    onClose: () => void;
}

const VerifyCertificate: React.FC<Props> = ({ certId, onClose }) => {
    const [cert, setCert] = useState<Certificate | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    useEffect(() => {
        const fetchCert = async () => {
            try {
                const data = await storageService.getCertificateById(certId);
                if (data) {
                    setCert(data);
                } else {
                    setError(true);
                }
            } catch (e) {
                setError(true);
            } finally {
                setLoading(false);
            }
        };
        fetchCert();
    }, [certId]);

    if (loading) {
        return (
            <div className="fixed inset-0 z-[200] bg-slate-50 dark:bg-slate-900 flex flex-col items-center justify-center">
                <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mb-4" />
                <p className="text-slate-600 dark:text-slate-400 font-medium">Vérification du certificat...</p>
            </div>
        );
    }

    if (error || !cert) {
        return (
            <div className="fixed inset-0 z-[200] bg-slate-50 dark:bg-slate-900 flex flex-col items-center justify-center p-6 text-center">
                <div className="w-20 h-20 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mb-6">
                    <XCircle className="w-10 h-10 text-red-600 dark:text-red-400" />
                </div>
                <h1 className="text-2xl font-black text-slate-900 dark:text-white mb-2">Certificat Introuvable</h1>
                <p className="text-slate-500 dark:text-slate-400 max-w-md mb-8">
                    Le certificat ID <strong>{certId}</strong> n'existe pas ou n'a pas pu être vérifié.
                </p>
                <button onClick={onClose} className="px-8 py-3 bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold rounded-xl hover:opacity-90 transition-opacity">
                    Retour à l'accueil
                </button>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-[200] bg-slate-50 dark:bg-slate-900 overflow-y-auto animate-fade-in">
            <div className="min-h-screen flex flex-col items-center justify-center p-6">
                <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 max-w-lg w-full overflow-hidden">
                    
                    {/* Header Valid */}
                    <div className="bg-emerald-500 p-8 text-center relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 blur-2xl"></div>
                        <div className="relative z-10">
                            <div className="w-16 h-16 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center mx-auto mb-4 border border-white/30 shadow-lg">
                                <CheckCircle className="w-8 h-8 text-white" />
                            </div>
                            <h1 className="text-2xl font-black text-white tracking-tight uppercase">Certificat Authentique</h1>
                            <p className="text-emerald-100 text-sm font-medium mt-1 opacity-90">Vérifié par TeacherMada</p>
                        </div>
                    </div>

                    {/* Details */}
                    <div className="p-8 space-y-6">
                        <div className="text-center mb-8">
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Délivré à</p>
                            <h2 className="text-3xl font-black text-slate-900 dark:text-white leading-tight">
                                {cert.userFullName || cert.userName}
                            </h2>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-2xl border border-slate-100 dark:border-slate-600">
                                <div className="flex items-center gap-2 mb-1 text-indigo-500">
                                    <Globe className="w-4 h-4" />
                                    <span className="text-xs font-bold uppercase">Langue</span>
                                </div>
                                <p className="font-bold text-slate-900 dark:text-white">{cert.language}</p>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-2xl border border-slate-100 dark:border-slate-600">
                                <div className="flex items-center gap-2 mb-1 text-purple-500">
                                    <Award className="w-4 h-4" />
                                    <span className="text-xs font-bold uppercase">Niveau</span>
                                </div>
                                <p className="font-bold text-slate-900 dark:text-white">{cert.level}</p>
                            </div>
                        </div>

                        <div className="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-2xl border border-slate-100 dark:border-slate-600 flex justify-between items-center">
                            <div>
                                <div className="flex items-center gap-2 mb-1 text-slate-500">
                                    <Calendar className="w-4 h-4" />
                                    <span className="text-xs font-bold uppercase">Date d'émission</span>
                                </div>
                                <p className="font-bold text-slate-900 dark:text-white">
                                    {new Date(cert.issueDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                                </p>
                            </div>
                            <div className="text-right">
                                <div className="text-xs font-bold text-slate-400 uppercase mb-1">Score Global</div>
                                <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{Math.round(cert.globalScore || cert.score)}%</p>
                            </div>
                        </div>

                        <div className="pt-6 border-t border-slate-100 dark:border-slate-700">
                            <p className="text-[10px] text-center text-slate-400 uppercase tracking-widest font-mono">
                                ID: {cert.id}
                            </p>
                        </div>

                        <button onClick={onClose} className="w-full py-4 bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold rounded-xl hover:opacity-90 transition-all active:scale-[0.98]">
                            Fermer la vérification
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default VerifyCertificate;
