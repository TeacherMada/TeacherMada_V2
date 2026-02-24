
import React, { useState } from 'react';
import { X, ArrowRight, Check } from 'lucide-react';

interface TutorialOverlayProps {
  onComplete: () => void;
}

const TutorialOverlay: React.FC<TutorialOverlayProps> = ({ onComplete }) => {
  const [step, setStep] = useState(0);

  const steps = [
    {
      targetId: 'topbar-mode',
      title: "Mode & Menu",
      text: "Changez de mode d'apprentissage, d'exercices ou de langue ici.",
      position: 'top-16 left-4'
    },
    {
      targetId: 'topbar-lesson-jump',
      title: "Navigation Rapide",
      text: "Cliquez ici pour sauter directement à une leçon spécifique.",
      position: 'top-16 left-1/2 -translate-x-1/2'
    },
    {
        targetId: 'topbar-explanation',
        title: "Langue d'Explication",
        text: "Changez la langue du professeur (Français 🇫🇷 ou Malagasy 🇲🇬) instantanément.",
        position: 'top-16 right-32'
    },
    {
      targetId: 'topbar-profile',
      title: "Profil & Progrès",
      text: "Suivez vos XP, vos défis et votre parcours d'apprentissage.",
      position: 'top-16 right-4'
    },
    {
      targetId: 'input-area',
      title: "Zone de Chat",
      text: "Tapez votre message ou utilisez le micro pour parler. Le professeur vous corrigera.",
      position: 'bottom-24 left-1/2 -translate-x-1/2'
    }
  ];

  const handleNext = () => {
    if (step < steps.length - 1) {
      setStep(prev => prev + 1);
    } else {
      onComplete();
    }
  };

  const currentStep = steps[step];

  return (
    <div className="fixed inset-0 z-[100] pointer-events-none">
      {/* Dark Overlay with cutout effect simulated by z-index stacking context in CSS is hard without a library. 
          We will use a simpler semi-transparent overlay that highlights via pulsing rings. */}
      <div className="absolute inset-0 bg-slate-900/60 pointer-events-auto transition-opacity duration-500"></div>

      {/* Tooltip Card */}
      <div 
        className={`absolute ${currentStep.position} w-72 bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-2xl border border-indigo-100 dark:border-slate-700 animate-bounce-slight pointer-events-auto transition-all duration-500`}
      >
        <div className="flex justify-between items-start mb-2">
            <h3 className="font-bold text-lg text-indigo-600 dark:text-indigo-400">{currentStep.title}</h3>
            <span className="text-xs font-bold text-slate-400 bg-slate-100 dark:bg-slate-900 px-2 py-1 rounded-full">{step + 1}/{steps.length}</span>
        </div>
        <p className="text-slate-600 dark:text-slate-300 text-sm mb-4 leading-relaxed">
            {currentStep.text}
        </p>
        <div className="flex justify-end gap-2">
            <button 
                onClick={onComplete}
                className="text-xs font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 px-3 py-2"
            >
                Passer
            </button>
            <button 
                onClick={handleNext}
                className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-1 shadow-lg transition-transform active:scale-95"
            >
                {step === steps.length - 1 ? 'Terminer' : 'Suivant'}
                {step === steps.length - 1 ? <Check className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
            </button>
        </div>
        
        {/* Arrow Pointer (Pseudo-element simulation) */}
        <div className={`absolute w-4 h-4 bg-white dark:bg-slate-800 transform rotate-45 border-l border-t border-indigo-100 dark:border-slate-700
            ${currentStep.position.includes('bottom') ? '-bottom-2 left-1/2 -translate-x-1/2 border-l-0 border-t-0 border-r border-b' : '-top-2 left-8'}
        `}></div>
      </div>

      {/* Highlighter Ring on target (This relies on the parent mapping the IDs correctly) */}
      {/* Note: In a real DOM implementation, we would calculate rects. Here we just guide the user's eye. */}
    </div>
  );
};

export default TutorialOverlay;
