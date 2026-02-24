
import React, { useState } from 'react';
import { X, BookOpen, MessageCircle, Phone, Sparkles, Brain, CreditCard, ChevronRight, Check } from 'lucide-react';

interface AppGuideProps {
  onClose: () => void;
}

const AppGuide: React.FC<AppGuideProps> = ({ onClose }) => {
  const [activeStep, setActiveStep] = useState(0);

  const steps = [
    {
      title: "Bienvenue",
      icon: <BookOpen className="w-8 h-8 text-indigo-500" />,
      content: (
        <div className="space-y-4">
          <p className="text-slate-600 dark:text-slate-300">
            Bienvenue sur <strong>TeacherMada</strong> ! Cette plateforme utilise l'Intelligence Artificielle pour vous apprendre les langues comme un vrai professeur.
          </p>
          <div className="bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-xl border border-indigo-100 dark:border-indigo-800">
            <h4 className="font-bold text-indigo-700 dark:text-indigo-300 text-sm mb-2">Comment ça marche ?</h4>
            <ul className="text-sm space-y-2 text-slate-600 dark:text-slate-300">
              <li className="flex gap-2"><Check className="w-4 h-4 text-emerald-500 shrink-0"/> Des cours structurés par le Chat.</li>
              <li className="flex gap-2"><Check className="w-4 h-4 text-emerald-500 shrink-0"/> De la pratique orale avec l'IA en direct.</li>
              <li className="flex gap-2"><Check className="w-4 h-4 text-emerald-500 shrink-0"/> Des crédits pour utiliser les outils puissants.</li>
            </ul>
          </div>
        </div>
      )
    },
    {
      title: "Système de Crédits",
      icon: <CreditCard className="w-8 h-8 text-amber-500" />,
      content: (
        <div className="space-y-4">
          <p className="text-slate-600 dark:text-slate-300">
            TeacherMada utilise des technologies coûteuses. Les crédits permettent de financer les serveurs.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700 text-center">
              <div className="font-black text-lg text-slate-800 dark:text-white">1 Crédit</div>
              <div className="text-xs text-slate-500 uppercase tracking-wide">Par message Chat</div>
            </div>
            <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700 text-center">
              <div className="font-black text-lg text-slate-800 dark:text-white">5 Crédits</div>
              <div className="text-xs text-slate-500 uppercase tracking-wide">Par minute d'Appel</div>
            </div>
          </div>
          <p className="text-xs text-slate-500 italic bg-amber-50 dark:bg-amber-900/10 p-2 rounded-lg">
            Astuce : Rechargez via Mobile Money (MVola, Airtel, Orange) en cliquant sur votre solde en haut.
          </p>
        </div>
      )
    },
    {
      title: "Chat & Leçons",
      icon: <MessageCircle className="w-8 h-8 text-blue-500" />,
      content: (
        <div className="space-y-4">
          <p className="text-slate-600 dark:text-slate-300">
            C'est votre espace principal. Le professeur vous donne des leçons écrites, explique la grammaire et vous corrige.
          </p>
          <ul className="space-y-3 text-sm">
            <li className="flex items-center gap-3 bg-white dark:bg-slate-800 p-3 rounded-xl shadow-sm">
              <span className="bg-blue-100 text-blue-600 font-bold px-2 py-1 rounded text-xs">Action</span>
              <span className="text-slate-700 dark:text-slate-200">Écrivez ou utilisez le micro pour répondre.</span>
            </li>
            <li className="flex items-center gap-3 bg-white dark:bg-slate-800 p-3 rounded-xl shadow-sm">
              <span className="bg-blue-100 text-blue-600 font-bold px-2 py-1 rounded text-xs">Audio</span>
              <span className="text-slate-700 dark:text-slate-200">Cliquez sur les icônes haut-parleur pour écouter.</span>
            </li>
          </ul>
        </div>
      )
    },
    {
      title: "Appel Vocal (Live)",
      icon: <Phone className="w-8 h-8 text-purple-500" />,
      content: (
        <div className="space-y-4">
          <p className="text-slate-600 dark:text-slate-300">
            Parlez en temps réel avec une IA native ! C'est le moyen le plus rapide pour devenir fluide.
          </p>
          <div className="bg-purple-50 dark:bg-purple-900/20 p-4 rounded-xl border border-purple-100 dark:border-purple-800">
            <h4 className="font-bold text-purple-700 dark:text-purple-300 text-sm mb-2">Comment faire ?</h4>
            <ol className="list-decimal pl-4 space-y-1 text-sm text-slate-600 dark:text-slate-300">
              <li>Cliquez sur le bouton "Live Teacher" dans le menu.</li>
              <li>L'IA se présente. Parlez-lui comme à un humain.</li>
              <li>Elle vous corrigera doucement si vous faites une faute.</li>
            </ol>
          </div>
        </div>
      )
    },
    {
      title: "Outils Pratiques",
      icon: <Sparkles className="w-8 h-8 text-emerald-500" />,
      content: (
        <div className="space-y-4">
          <div className="flex gap-4">
             <div className="flex-1 bg-white dark:bg-slate-800 p-4 rounded-2xl shadow-sm text-center">
                <Brain className="w-8 h-8 text-amber-500 mx-auto mb-2" />
                <div className="font-bold text-sm">Exercices</div>
                <p className="text-[10px] text-slate-500 mt-1">Quiz générés sur mesure pour vous tester.</p>
             </div>
             <div className="flex-1 bg-white dark:bg-slate-800 p-4 rounded-2xl shadow-sm text-center">
                <Sparkles className="w-8 h-8 text-violet-500 mx-auto mb-2" />
                <div className="font-bold text-sm">Jeux de Rôle</div>
                <p className="text-[10px] text-slate-500 mt-1">Simulations (Marché, Docteur, etc.).</p>
             </div>
          </div>
        </div>
      )
    }
  ];

  const current = steps[activeStep];

  return (
    <div className="fixed inset-0 z-[200] bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in font-sans">
      <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-[2rem] shadow-2xl overflow-hidden flex flex-col h-[550px]">
        
        {/* Header Image/Icon Area */}
        <div className="bg-slate-50 dark:bg-slate-950 p-8 flex flex-col items-center justify-center border-b border-slate-100 dark:border-slate-800 h-40 shrink-0 relative">
            <button onClick={onClose} className="absolute top-4 right-4 p-2 bg-white dark:bg-slate-800 rounded-full hover:text-red-500 transition-colors shadow-sm">
                <X className="w-5 h-5"/>
            </button>
            <div className="w-16 h-16 bg-white dark:bg-slate-800 rounded-2xl shadow-lg flex items-center justify-center mb-3 animate-bounce-slight">
                {current.icon}
            </div>
            <h2 className="text-xl font-black text-slate-800 dark:text-white">{current.title}</h2>
        </div>

        {/* Content */}
        <div className="flex-1 p-6 overflow-y-auto">
            {current.content}
        </div>

        {/* Footer Navigation */}
        <div className="p-6 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
            <div className="flex justify-between items-center mb-4">
                <div className="flex gap-1.5">
                    {steps.map((_, idx) => (
                        <div key={idx} className={`w-2 h-2 rounded-full transition-all duration-300 ${idx === activeStep ? 'w-6 bg-indigo-600' : 'bg-slate-200 dark:bg-slate-700'}`}></div>
                    ))}
                </div>
                <span className="text-xs font-bold text-slate-400">{activeStep + 1} / {steps.length}</span>
            </div>
            
            <button 
                onClick={() => {
                    if (activeStep < steps.length - 1) setActiveStep(prev => prev + 1);
                    else onClose();
                }}
                className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl shadow-lg shadow-indigo-500/30 transition-transform active:scale-95 flex items-center justify-center gap-2"
            >
                {activeStep < steps.length - 1 ? (
                    <>Suivant <ChevronRight className="w-5 h-5"/></>
                ) : (
                    "C'est parti !"
                )}
            </button>
        </div>

      </div>
    </div>
  );
};

export default AppGuide;
