import React, { useState, useEffect } from 'react';
import { ExerciseItem } from '../types';
import { Check, X, ArrowRight, Trophy, RefreshCcw, HelpCircle } from 'lucide-react';
import MarkdownRenderer from './MarkdownRenderer';

interface ExerciseSessionProps {
  exercises: ExerciseItem[];
  onClose: () => void;
  onComplete: (score: number, total: number) => void;
}

const ExerciseSession: React.FC<ExerciseSessionProps> = ({ exercises, onClose, onComplete }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [isChecked, setIsChecked] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [showSummary, setShowSummary] = useState(false);

  const currentExercise = exercises[currentIndex];
  const progress = ((currentIndex) / exercises.length) * 100;

  // Reset state when moving to next question
  useEffect(() => {
    setSelectedAnswer(null);
    setInputValue('');
    setIsChecked(false);
    setIsCorrect(false);
  }, [currentIndex]);

  const normalizeText = (text: string) => text.trim().toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, "");

  const handleCheck = () => {
    let correct = false;
    const answer = currentExercise.type === 'fill_blank' ? inputValue : selectedAnswer;

    if (!answer) return;

    const normUser = normalizeText(String(answer));
    const normCorrect = normalizeText(String(currentExercise.correctAnswer));

    if (currentExercise.type === 'true_false') {
        // Handle language variations and boolean strings for robustness
        const trueVariants = ['vrai', 'true', 'yes', 'oui'];
        const falseVariants = ['faux', 'false', 'no', 'non'];

        const userIsTrue = trueVariants.includes(normUser);
        const correctIsTrue = trueVariants.includes(normCorrect);
        
        const userIsFalse = falseVariants.includes(normUser);
        const correctIsFalse = falseVariants.includes(normCorrect);

        // If both map to the same boolean concept (True or False), it's correct
        if (userIsTrue && correctIsTrue) correct = true;
        else if (userIsFalse && correctIsFalse) correct = true;
        // Fallback to direct text comparison (e.g. if answer is something else)
        else correct = normUser === normCorrect;
    } else {
        // For Multiple Choice and Fill Blank, standard normalization
        correct = normUser === normCorrect;
    }

    setIsCorrect(correct);
    if (correct) {
        setScore(prev => prev + 1);
        setStreak(prev => prev + 1);
    } else {
        setStreak(0);
    }
    setIsChecked(true);
  };

  const handleNext = () => {
    if (currentIndex < exercises.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else {
      setShowSummary(true);
    }
  };

  const handleFinish = () => {
    onComplete(score, exercises.length);
  };

  if (showSummary) {
    return (
      <div className="fixed inset-0 z-[70] bg-slate-900/95 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
        <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-3xl p-8 text-center shadow-2xl border border-white/10 relative overflow-hidden">
          {score === exercises.length && (
            <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-0 left-1/4 w-2 h-2 bg-yellow-400 rounded-full animate-ping"></div>
                <div className="absolute top-10 right-1/4 w-3 h-3 bg-red-400 rounded-full animate-ping delay-100"></div>
                <div className="absolute bottom-10 left-10 w-2 h-2 bg-blue-400 rounded-full animate-ping delay-200"></div>
            </div>
          )}
          
          <div className="mb-6 flex justify-center">
             <div className="w-24 h-24 bg-yellow-100 dark:bg-yellow-900/30 rounded-full flex items-center justify-center border-4 border-yellow-200 dark:border-yellow-700">
               <Trophy className="w-12 h-12 text-yellow-500" />
             </div>
          </div>
          
          <h2 className="text-3xl font-bold text-slate-800 dark:text-white mb-2">Session Terminée !</h2>
          <p className="text-slate-500 dark:text-slate-400 mb-6">Voici votre résultat final</p>
          
          <div className="text-6xl font-black text-indigo-600 dark:text-indigo-400 mb-8">
            {score}/{exercises.length}
          </div>
          
          <div className="grid grid-cols-2 gap-4 mb-8">
            <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-2xl">
                <div className="text-xs text-slate-400 font-bold uppercase">XP Gagnée</div>
                <div className="text-2xl font-bold text-emerald-500">+{score * 10 + 20} XP</div>
            </div>
            <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-2xl">
                <div className="text-xs text-slate-400 font-bold uppercase">Précision</div>
                <div className="text-2xl font-bold text-indigo-500">{Math.round((score / exercises.length) * 100)}%</div>
            </div>
          </div>

          <button 
            onClick={handleFinish}
            className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-lg transition-transform active:scale-95"
          >
            Continuer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] bg-slate-50 dark:bg-slate-950 flex flex-col transition-colors duration-300">
      {/* Header */}
      <div className="h-16 px-4 flex items-center justify-between bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800">
        <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors">
            <X className="w-6 h-6 text-slate-500" />
        </button>
        <div className="flex-1 max-w-md mx-4">
            <div className="h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                <div 
                    className="h-full bg-indigo-500 transition-all duration-500 ease-out"
                    style={{ width: `${progress}%` }}
                ></div>
            </div>
        </div>
        <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 font-bold">
            {streak > 1 && (
                <div className="flex items-center gap-1 text-orange-500 animate-bounce mr-2">
                    <span className="text-xs">🔥 {streak}</span>
                </div>
            )}
            <span className="text-sm">{score}</span>
            <Trophy className="w-4 h-4" />
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6 pb-40 flex flex-col items-center justify-center max-w-2xl mx-auto w-full">
         <div className="w-full animate-slide-up">
            <h2 className="text-2xl md:text-3xl font-bold text-slate-800 dark:text-white mb-8 text-center leading-relaxed">
                {currentExercise.question}
            </h2>

            {/* Interactions based on Type */}
            <div className="space-y-4 w-full">
                
                {/* Multiple Choice */}
                {currentExercise.type === 'multiple_choice' && (
                    <div className="grid grid-cols-1 gap-3">
                        {currentExercise.options?.map((opt, idx) => (
                            <button
                                key={idx}
                                onClick={() => !isChecked && setSelectedAnswer(opt)}
                                disabled={isChecked}
                                className={`p-4 rounded-xl border-2 text-left text-lg font-medium transition-all ${
                                    isChecked 
                                        ? normalizeText(opt) === normalizeText(currentExercise.correctAnswer) 
                                            ? 'bg-emerald-100 dark:bg-emerald-900/30 border-emerald-500 text-emerald-800 dark:text-emerald-300'
                                            : opt === selectedAnswer 
                                                ? 'bg-red-100 dark:bg-red-900/30 border-red-500 text-red-800 dark:text-red-300'
                                                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 opacity-50'
                                        : selectedAnswer === opt
                                            ? 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-500 text-indigo-800 dark:text-indigo-300 shadow-md transform scale-[1.02]'
                                            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-700 text-slate-700 dark:text-slate-200'
                                }`}
                            >
                                <span className="inline-block w-8 font-bold opacity-50">{String.fromCharCode(65 + idx)}.</span> {opt}
                            </button>
                        ))}
                    </div>
                )}

                {/* True / False */}
                {currentExercise.type === 'true_false' && (
                    <div className="grid grid-cols-2 gap-4">
                        {['Vrai', 'Faux'].map((opt) => (
                             <button
                                key={opt}
                                onClick={() => !isChecked && setSelectedAnswer(opt)}
                                disabled={isChecked}
                                className={`p-8 rounded-2xl border-2 text-center text-xl font-bold transition-all ${
                                    isChecked 
                                        ? (() => {
                                            // Determine visual state for T/F based on correctness
                                            const normOpt = normalizeText(opt);
                                            const normCorrect = normalizeText(String(currentExercise.correctAnswer));
                                            const trueSet = ['vrai', 'true', 'yes'];
                                            const isOptTrue = trueSet.includes(normOpt);
                                            const isCorrectTrue = trueSet.includes(normCorrect);
                                            // Check if this option represents the correct answer
                                            const isThisCorrect = (isOptTrue && isCorrectTrue) || (!isOptTrue && !isCorrectTrue);
                                            
                                            if (isThisCorrect) return 'bg-emerald-100 dark:bg-emerald-900/30 border-emerald-500 text-emerald-800 dark:text-emerald-300';
                                            if (opt === selectedAnswer) return 'bg-red-100 dark:bg-red-900/30 border-red-500 text-red-800 dark:text-red-300';
                                            return 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 opacity-50';
                                        })()
                                        : selectedAnswer === opt
                                            ? 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-500 text-indigo-800 dark:text-indigo-300 shadow-lg'
                                            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-indigo-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                                }`}
                             >
                                {opt}
                             </button>
                        ))}
                    </div>
                )}

                {/* Fill Blank */}
                {currentExercise.type === 'fill_blank' && (
                    <div className="w-full">
                        <input
                            type="text"
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            disabled={isChecked}
                            placeholder="Tapez votre réponse ici..."
                            className={`w-full p-5 text-xl rounded-xl border-2 outline-none transition-all ${
                                isChecked
                                    ? isCorrect 
                                        ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-300'
                                        : 'border-red-500 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300'
                                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:border-indigo-500'
                            }`}
                        />
                         {isChecked && !isCorrect && (
                            <div className="mt-2 text-slate-500 text-sm">
                                Réponse attendue : <span className="font-bold text-slate-700 dark:text-slate-300">{currentExercise.correctAnswer}</span>
                            </div>
                        )}
                    </div>
                )}
            </div>
         </div>
      </div>

      {/* Footer / Feedback Area */}
      <div className={`fixed bottom-0 w-full p-4 md:p-6 transition-transform duration-300 border-t ${
          isChecked 
            ? isCorrect 
                ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-900' 
                : 'bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-900'
            : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800'
      }`}>
        <div className="max-w-2xl mx-auto">
            {isChecked ? (
                <div className="animate-fade-in">
                    <div className="flex items-start gap-4 mb-4">
                        <div className={`p-2 rounded-full ${isCorrect ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}`}>
                            {isCorrect ? <Check className="w-6 h-6" /> : <X className="w-6 h-6" />}
                        </div>
                        <div className="flex-1">
                            <h3 className={`font-bold text-lg ${isCorrect ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
                                {isCorrect ? 'Excellent !' : 'Pas tout à fait...'}
                            </h3>
                            <div className="mt-2 text-slate-600 dark:text-slate-300 text-sm">
                                 <div className="font-semibold mb-1 flex items-center gap-1 text-indigo-500">
                                    <HelpCircle className="w-3.5 h-3.5" /> Explication :
                                 </div>
                                 <MarkdownRenderer content={currentExercise.explanation} />
                            </div>
                        </div>
                    </div>
                    <button 
                        onClick={handleNext}
                        className={`w-full py-4 rounded-xl font-bold text-white shadow-lg transition-transform active:scale-95 flex items-center justify-center gap-2
                            ${isCorrect ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}`}
                    >
                        {currentIndex < exercises.length - 1 ? 'Continuer' : 'Voir le résultat'}
                        <ArrowRight className="w-5 h-5" />
                    </button>
                </div>
            ) : (
                <button 
                    onClick={handleCheck}
                    disabled={(!selectedAnswer && !inputValue)}
                    className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-bold rounded-xl shadow-lg transition-all"
                >
                    Vérifier
                </button>
            )}
        </div>
      </div>
    </div>
  );
};

export default ExerciseSession;