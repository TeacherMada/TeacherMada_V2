
import React, { useState } from 'react';
import { UserProfile } from '../types';
import { storageService } from '../services/storageService';
import { GraduationCap, ArrowRight, Sun, Moon, Mail, Lock, User, ArrowLeft, HelpCircle, Phone, X, Send, AlertTriangle } from 'lucide-react';
import LegalModal from './LegalModals';

interface AuthScreenProps {
  onAuthSuccess: (user: UserProfile) => void;
  onBack: () => void;
  isDarkMode: boolean;
  toggleTheme: () => void;
  notify: (message: string, type: 'success' | 'error' | 'info') => void;
}

const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthSuccess, onBack, isDarkMode, toggleTheme, notify }) => {
  const [isRegistering, setIsRegistering] = useState(false);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [activeLegal, setActiveLegal] = useState<'privacy' | 'terms' | null>(null);
  const [forgotData, setForgotData] = useState({ username: '', phone: '', email: '' });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!username.trim() || !password.trim()) {
        setErrorMessage("Veuillez remplir les champs obligatoires.");
        return;
    }

    setIsLoading(true);
    
    try {
        // IMPORTANT: Await the async Supabase calls
        let result;
        if (isRegistering) {
            result = await storageService.register(username, password, email, phoneNumber);
        } else {
            result = await storageService.login(username, password);
        }

        if (result.success && result.user) {
            onAuthSuccess(result.user);
        } else {
            setErrorMessage(result.error || "Une erreur est survenue.");
            notify(result.error || "Erreur de connexion.", 'error');
        }
    } catch (error) {
        console.error(error);
        setErrorMessage("Erreur critique de connexion.");
    } finally {
        setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-4 transition-colors duration-300 relative font-sans">
       
       <LegalModal type={activeLegal} onClose={() => setActiveLegal(null)} />

      <div className="absolute top-0 left-0 w-full p-6 flex justify-between items-center z-10">
          <button onClick={onBack} className="p-3 bg-white dark:bg-slate-900 shadow-sm rounded-full text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all hover:scale-105"><ArrowLeft className="w-5 h-5" /></button>
          <button onClick={toggleTheme} className="p-3 rounded-full bg-white dark:bg-slate-900 shadow-sm hover:shadow-md text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all cursor-pointer"><Sun className="w-5 h-5" /></button>
      </div>

      <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-[2rem] shadow-2xl p-8 pt-0 transform transition-all duration-500 animate-fade-in relative overflow-visible mt-16 border border-slate-100 dark:border-slate-800">
        
        <div className="flex flex-col items-center justify-center -mt-16 mb-6 relative z-20">
          <div className="group w-28 h-28 bg-white dark:bg-slate-800 rounded-3xl shadow-[0_20px_40px_-10px_rgba(79,70,229,0.3)] flex items-center justify-center relative z-20 border-4 border-slate-50 dark:border-slate-900 transform transition-transform duration-500 hover:scale-105 hover:-rotate-1">
             <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-purple-500/5 rounded-2xl"></div>
             <img src="https://i.ibb.co/B2XmRwmJ/logo.png" onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = '/logo.svg'; }} alt="Logo" className="w-full h-full object-contain p-4 drop-shadow-sm" />
          </div>
          
          <h1 className="text-2xl font-black text-slate-900 dark:text-white text-center mt-6 tracking-tight">
              {isRegistering ? "Créer un compte" : "Bon retour"}
          </h1>
        </div>

        <div className="flex bg-slate-100 dark:bg-slate-800/80 p-1.5 rounded-2xl mb-8 relative z-10">
            <button onClick={() => { setIsRegistering(false); setErrorMessage(null); }} className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all ${!isRegistering ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-white shadow-sm ring-1 ring-black/5 dark:ring-white/10' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>Connexion</button>
            <button onClick={() => { setIsRegistering(true); setErrorMessage(null); }} className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all ${isRegistering ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-white shadow-sm ring-1 ring-black/5 dark:ring-white/10' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>Inscription</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 relative z-10">
          
          {errorMessage && (
              <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 text-xs font-bold p-3 rounded-xl flex items-center gap-2 animate-fade-in">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {errorMessage}
              </div>
          )}

          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 mb-1.5 ml-3 tracking-widest uppercase">
                {isRegistering ? "NOM D'UTILISATEUR" : "EMAIL / TÉL / NOM"}
            </label>
            <div className="relative group">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-indigo-500 transition-colors"><User className="w-full h-full" /></div>
                <input type="text" required value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Votre nom pour le certificat" className="w-full bg-slate-50 dark:bg-slate-800/50 text-slate-800 dark:text-white rounded-2xl pl-12 pr-4 py-4 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 dark:focus:border-indigo-400 transition-all border border-slate-200 dark:border-slate-700 font-medium placeholder:text-slate-400 text-sm" />
            </div>
          </div>

          {isRegistering && (
            <div className="space-y-5 animate-fade-in">
                <div>
                    <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 mb-1.5 ml-3 tracking-widest uppercase">EMAIL (OPTIONNEL)</label>
                    <div className="relative group">
                        <div className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-indigo-500 transition-colors"><Mail className="w-full h-full" /></div>
                        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Pour récupérer le compte" className="w-full bg-slate-50 dark:bg-slate-800/50 text-slate-800 dark:text-white rounded-2xl pl-12 pr-4 py-4 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 dark:focus:border-indigo-400 transition-all border border-slate-200 dark:border-slate-700 font-medium placeholder:text-slate-400 text-sm" />
                    </div>
                </div>
                <div>
                    <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 mb-1.5 ml-3 tracking-widest uppercase">NUMÉRO (OPTIONNEL)</label>
                    <div className="relative group">
                        <div className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-indigo-500 transition-colors"><Phone className="w-full h-full" /></div>
                        <input type="tel" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="034 00 000 00" className="w-full bg-slate-50 dark:bg-slate-800/50 text-slate-800 dark:text-white rounded-2xl pl-12 pr-4 py-4 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 dark:focus:border-indigo-400 transition-all border border-slate-200 dark:border-slate-700 font-medium placeholder:text-slate-400 text-sm" />
                    </div>
                </div>
            </div>
          )}

          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 mb-1.5 ml-3 tracking-widest uppercase">MOT DE PASSE</label>
            <div className="relative group">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-indigo-500 transition-colors"><Lock className="w-full h-full" /></div>
                <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="w-full bg-slate-50 dark:bg-slate-800/50 text-slate-800 dark:text-white rounded-2xl pl-12 pr-4 py-4 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 dark:focus:border-indigo-400 transition-all border border-slate-200 dark:border-slate-700 font-medium placeholder:text-slate-400 text-sm" />
            </div>
          </div>

          <button type="submit" disabled={isLoading} className="w-full mt-8 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-2xl shadow-lg hover:shadow-indigo-500/30 transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed group transform active:scale-[0.98]">
            {isLoading ? "Connexion..." : (isRegistering ? "Commencer" : "Se connecter")}
            {!isLoading && <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />}
          </button>
        </form>

        <div className="mt-8 text-center border-t border-slate-100 dark:border-slate-800 pt-4 pb-2">
            <p className="text-[10px] text-slate-400 dark:text-slate-500">
                En vous connectant, vous acceptez nos 
                <button onClick={() => setActiveLegal('terms')} className="text-indigo-500 hover:underline mx-1 font-bold">Conditions</button>.
            </p>
        </div>
      </div>
    </div>
  );
};

export default AuthScreen;
