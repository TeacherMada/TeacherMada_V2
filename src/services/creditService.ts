import { storageService } from './storageService';

export const CREDIT_COSTS = {
  LESSON: 2,
  AUDIO_MESSAGE: 2,
  AUDIO_PRONUNCIATION: 1,
  DIALOGUE_MESSAGE: 1,
  EXERCISE: 5,
  VOICE_CALL_PER_MINUTE: 5,
  DIAGNOSTIC: 40,
  EXAM: 100,
  CERTIFICATE: 100,
};

export const creditService = {
  checkBalance: async (userId: string, requiredAmount: number): Promise<boolean> => {
    return await storageService.canRequest(userId, requiredAmount);
  },

  deduct: async (userId: string, amount: number): Promise<boolean> => {
    return await storageService.deductCredits(userId, amount);
  },

  isCertificateUnlocked: (certId: string): boolean => {
    const unlocked = localStorage.getItem(`tm_unlocked_certs`);
    if (!unlocked) return false;
    try {
      const parsed = JSON.parse(unlocked);
      return parsed.includes(certId);
    } catch {
      return false;
    }
  },
  
  unlockCertificate: (certId: string) => {
    const unlocked = localStorage.getItem(`tm_unlocked_certs`);
    let parsed: string[] = [];
    if (unlocked) {
      try { parsed = JSON.parse(unlocked); } catch {}
    }
    if (!parsed.includes(certId)) {
      parsed.push(certId);
      localStorage.setItem(`tm_unlocked_certs`, JSON.stringify(parsed));
    }
  }
};
