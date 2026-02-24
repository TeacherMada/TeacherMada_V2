import React, { createContext, useContext, useState, useEffect } from 'react';
import { Language, getTranslation } from '../i18n';
import { storageService } from '../services/storageService';
import { UserProfile } from '../types';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    const saved = localStorage.getItem('tm_language');
    return (saved === 'mg' || saved === 'fr') ? saved : 'fr';
  });

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('tm_language', lang);
    
    // Update user profile if logged in
    storageService.getCurrentUser().then(user => {
      if (user && user.preferences) {
        const updatedUser = {
          ...user,
          preferences: {
            ...user.preferences,
            explanationLanguage: lang === 'mg' ? 'Malagasy 🇲🇬' : 'Français 🇫🇷'
          }
        };
        storageService.saveUserProfile(updatedUser);
      }
    });
  };

  // Sync with user profile on load/change
  useEffect(() => {
    const syncWithUser = async () => {
      const user = await storageService.getCurrentUser();
      if (user && user.preferences && user.preferences.explanationLanguage) {
        const prefLang = user.preferences.explanationLanguage.includes('Malagasy') ? 'mg' : 'fr';
        if (prefLang !== language) {
          setLanguageState(prefLang);
          localStorage.setItem('tm_language', prefLang);
        }
      }
    };
    syncWithUser();
    
    // Subscribe to user updates to sync language if changed elsewhere (e.g. settings)
    const unsub = storageService.subscribeToUserUpdates((updatedUser) => {
        if (updatedUser.preferences && updatedUser.preferences.explanationLanguage) {
            const prefLang = updatedUser.preferences.explanationLanguage.includes('Malagasy') ? 'mg' : 'fr';
            setLanguageState(prefLang); // Update local state without triggering save loop
            localStorage.setItem('tm_language', prefLang);
        }
    });
    return () => unsub();
  }, []);

  const t = (key: string, params?: Record<string, string | number>) => {
    return getTranslation(language, key, params);
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useTranslation = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useTranslation must be used within a LanguageProvider');
  }
  return context;
};
