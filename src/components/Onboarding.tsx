import React, { useState, useMemo, useEffect } from 'react';
import { TargetLanguage, ExplanationLanguage, LearningMode, UserPreferences, LanguageLevel, LevelDescriptor } from '../types';
import { LEVEL_DEFINITIONS, getFlagUrl } from '../constants'; // Import helper
import { storageService } from '../services/storageService';
import { Languages, Sun, Moon, ArrowLeft, CheckCircle2, HelpCircle, Loader2 } from 'lucide-react';
import { useTranslation } from '../contexts/LanguageContext';

interface OnboardingProps {
  onComplete: (prefs: UserPreferences) => void;
  isDarkMode: boolean;
  toggleTheme: () => void;
}

interface LanguageOption {
  code: string;
  baseName: string;
  flagUrl: string;
}

const Onboarding: React.FC<OnboardingProps> = ({ onComplete, isDarkMode, toggleTheme }) => {
  const { t, language, setLanguage } = useTranslation();
  const [step, setStep] = useState(1);
  const [prefs, setPrefs] = useState<Partial<UserPreferences>>({});
  const [selectedLevelDesc, setSelectedLevelDesc] = useState<LevelDescriptor | null>(null);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [customLangs, setCustomLangs] = useState<any[]>([]);

  useEffect(() => {
      const loadSettings = async () => {
          try {
              const settings = storageService.getSystemSettings();
              setCustomLangs(settings.customLanguages || []);
          } finally {
              setIsLoadingSettings(false);
          }
      };
      loadSettings();
  }, []);

  const allLanguages = useMemo(() => {
      const staticLangs = Object.entries(TargetLanguage);
      const formattedStatic: LanguageOption[] = staticLangs.map(([key, value]) => {
          const baseName = (value as string).split(' ')[0];
          return {
              code: value as string,
              baseName: t(`languages.${key}`) || baseName,
              flagUrl: getFlagUrl(baseName)
          };
      });
      
      const formattedCustom = customLangs.map(l => ({
          code: l.code,
          baseName: l.baseName,
          flagUrl: getFlagUrl(l.baseName)
      }));

      return [...formattedStatic, ...formattedCustom];
  }, [customLangs, t]);

  const availableLevels = useMemo(() => {
    if (prefs.targetLanguage && (prefs.targetLanguage as string).includes("Chinois")) {
        return ['HSK 1', 'HSK 2', 'HSK 3', 'HSK 4', 'HSK 5', 'HSK 6'];
    }
    return ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  }, [prefs.targetLanguage]);

  const handleLanguageSelect = (langCode: string) => {
    setPrefs(prev => ({ ...prev, targetLanguage: langCode }));
    setStep(2);
  };

  const handleLevelSelect = (levelCode: string) => {
      const desc = LEVEL_DEFINITIONS[levelCode] || { 
          code: levelCode as LanguageLevel, 
          title: levelCode, 
          description: "Niveau standard", 
          skills: [], 
          example: "" 
      };
      setSelectedLevelDesc(desc);
  };

  const confirmLevel = () => {
      if (selectedLevelDesc) {
          setPrefs(prev => ({ ...prev, level: selectedLevelDesc.code, needsAssessment: false }));
          setStep(3);
      }
  };

  const handleUnknownLevel = () => {
      const defaultLevel = prefs.targetLanguage?.includes("Chinois") ? 'HSK 1' : 'A1';
      setPrefs(prev => ({ ...prev, level: defaultLevel, needsAssessment: true }));
      setStep(3);
  };

  const handleExplanationSelect = (lang: ExplanationLanguage) => {
      // Sync app language with explanation language choice
      const appLang = (lang as string).includes('Malagasy') ? 'mg' : 'fr';
      setLanguage(appLang);

      const finalPrefs = { 
        ...prefs, 
        explanationLanguage: lang, 
        mode: LearningMode.Course,
        fontSize: 'normal',
        voiceName: 'Kore'
      } as UserPreferences;
      onComplete(finalPrefs);
  };

  const handleBack = () => {
    if (step === 2 && selectedLevelDesc) {
        setSelectedLevelDesc(null);
        return;
    }
    if (step > 1) {
        setStep(prev => prev - 1);
        setSelectedLevelDesc(null);
    }
  };

  if (isLoadingSettings) {
      return (
          <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
              <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
          </div>
      );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-4 transition-colors duration-300 relative font-sans">
      <div className="absolute top-5 right-5 flex items-center gap-3 z-50">
        <div className="flex bg-white dark:bg-slate-900 rounded-full p-1 shadow-md border border-slate-100 dark:border-slate-800">
            <button 
                onClick={() => setLanguage('fr')}
                className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${language === 'fr' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-indigo-600'}`}
            >
                FR
            </button>
            <button 
                onClick={() => setLanguage('mg')}
                className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${language === 'mg' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-indigo-600'}`}
            >
                MG
            </button>
        </div>
        <button onClick={toggleTheme} className="p-3 rounded-full bg-white dark:bg-slate-900 shadow-md hover:shadow-lg text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all cursor-pointer">
            {isDarkMode ? <Sun className="w-6 h-6" /> : <Moon className="w-6 h-6" />}
        </button>
      </div>

      {step > 1 && (
        <button onClick={handleBack} className="absolute top-5 left-5 p-3 rounded-full bg-white dark:bg-slate-900 shadow-md hover:shadow-lg text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all cursor-pointer z-50">
            <ArrowLeft className="w-6 h-6" />
        </button>
      )}

      <div className="max-w-2xl w-full bg-white dark:bg-slate-900 rounded-[2rem] shadow-2xl p-8 transform transition-all duration-500 relative border border-slate-100 dark:border-slate-800">
        <div className="mb-8 flex items-center gap-2">
            <div className={`h-2 flex-1 rounded-full transition-all duration-500 ${step >= 1 ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-800'}`}></div>
            <div className={`h-2 flex-1 rounded-full transition-all duration-500 ${step >= 2 ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-800'}`}></div>
            <div className={`h-2 flex-1 rounded-full transition-all duration-500 ${step >= 3 ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-800'}`}></div>
        </div>

        {step === 1 && (
          <div className="animate-fade-in text-center">
            <div className="w-20 h-20 bg-indigo-50 dark:bg-indigo-900/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <Languages className="w-10 h-10 text-indigo-600 dark:text-indigo-400" />
            </div>
            <h2 className="text-2xl md:text-3xl font-black mb-2 text-slate-900 dark:text-white">{t('onboarding.select_language')}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[400px] overflow-y-auto scrollbar-hide mt-8">
              {allLanguages.map((lang, idx) => (
                <button
                  key={idx}
                  onClick={() => handleLanguageSelect(lang.code)}
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-indigo-500 dark:hover:border-indigo-400 hover:bg-indigo-50 dark:hover:bg-slate-800 transition-all flex items-center group text-left shadow-sm hover:shadow-md"
                >
                  <img src={lang.flagUrl} alt={lang.baseName} className="w-8 h-auto rounded-sm shadow-sm mr-4" />
                  <div>
                      <span className="font-bold text-lg text-slate-800 dark:text-white block">{lang.baseName}</span>
                      <span className="text-xs text-slate-400 group-hover:text-indigo-500 dark:group-hover:text-indigo-300">{t('common.select')}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 2 && !selectedLevelDesc && (
          <div className="animate-fade-in">
            <div className="text-center mb-8">
                <h2 className="text-2xl md:text-3xl font-black text-slate-900 dark:text-white mb-2">{t('onboarding.select_level')}</h2>
                <p className="text-slate-500 dark:text-slate-400 text-sm">{t('onboarding.level_desc')}</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
              {availableLevels.map((levelCode) => {
                  const def = LEVEL_DEFINITIONS[levelCode] || { code: levelCode, title: levelCode };
                  const levelKey = levelCode.replace(' ', '');
                  const translatedTitle = t(`levels.${levelKey}.title`) || def.title;
                  
                  return (
                    <button key={levelCode} onClick={() => handleLevelSelect(levelCode)} className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-indigo-500 hover:scale-105 transition-all text-center flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-800/50">
                      <div className="text-2xl font-black text-indigo-600 dark:text-indigo-400 mb-1">{def.code}</div>
                      <div className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-tight">{translatedTitle.split(' /')[0]}</div>
                    </button>
                  );
              })}
            </div>
            <div className="text-center">
                <button onClick={handleUnknownLevel} className="inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors px-4 py-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800">
                    <HelpCircle className="w-4 h-4" /> {t('onboarding.unknown_level')}
                </button>
            </div>
          </div>
        )}

        {step === 2 && selectedLevelDesc && (
            <div className="animate-slide-up">
                <div className="text-center mb-6">
                    <div className="inline-block px-4 py-1 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-black text-xl mb-4">{selectedLevelDesc.code}</div>
                    <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                        {t(`levels.${selectedLevelDesc.code.replace(' ', '')}.title`) || selectedLevelDesc.title}
                    </h3>
                    <p className="text-slate-600 dark:text-slate-300 italic">
                        "{t(`levels.${selectedLevelDesc.code.replace(' ', '')}.description`) || selectedLevelDesc.description}"
                    </p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-6 border border-slate-200 dark:border-slate-700 mb-6">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">{t('onboarding.skills_expected')}</h4>
                    <ul className="space-y-2 mb-6">
                        {(t(`levels.${selectedLevelDesc.code.replace(' ', '')}.skills`) || selectedLevelDesc.skills).map((skill: string, i: number) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
                                <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                                {skill}
                            </li>
                        ))}
                    </ul>
                </div>
                <div className="flex flex-col gap-3">
                    <button onClick={confirmLevel} className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-lg transition-transform active:scale-[0.98] flex items-center justify-center gap-2">
                        {t('onboarding.confirm_level')} <ArrowLeft className="w-4 h-4 rotate-180" />
                    </button>
                    <button onClick={() => setSelectedLevelDesc(null)} className="w-full py-3 text-slate-500 font-bold hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors">{t('onboarding.change_level')}</button>
                </div>
            </div>
        )}

        {step === 3 && (
          <div className="animate-fade-in text-center">
            <h2 className="text-2xl font-bold mb-6 text-slate-900 dark:text-white">{t('onboarding.explanation_language')}</h2>
            <p className="text-slate-500 dark:text-slate-400 mb-8">{t('onboarding.explanation_desc')}</p>
            <div className="grid grid-cols-2 gap-4">
              {Object.entries(ExplanationLanguage).map(([key, value]) => (
                <button key={key} onClick={() => handleExplanationSelect(value)} className="p-6 border dark:border-slate-700 rounded-2xl hover:border-indigo-500 dark:hover:border-indigo-400 hover:bg-indigo-50 dark:hover:bg-slate-800 transition-all flex flex-col items-center justify-center text-center group">
                  <img src={getFlagUrl((value as string).split(' ')[0])} alt={value} className="w-12 h-auto mb-4 group-hover:scale-110 transition-transform shadow-md rounded" />
                  <span className="font-bold text-slate-700 dark:text-slate-200">{t(`languages.${key}`) || (value as string).split(' ')[0]}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Onboarding;