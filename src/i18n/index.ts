import { fr } from './fr';
import { mg } from './mg';

export const translations = {
  fr,
  mg
};

export type Language = 'fr' | 'mg';

// Helper to get nested value
export const getTranslation = (lang: Language, key: string, params?: Record<string, string | number>) => {
  const keys = key.split('.');
  let value: any = translations[lang];
  
  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = value[k as keyof typeof value];
    } else {
      return key; // Fallback to key if not found
    }
  }

  if (typeof value !== 'string') return key;

  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      value = value.replace(`{${k}}`, String(v));
    });
  }

  return value;
};
