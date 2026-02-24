
export type UserRole = 'user' | 'admin';
export type VoiceName = 'Zephyr' | 'Puck' | 'Charon' | 'Kore' | 'Fenrir';

export enum TargetLanguage {
  English = 'Anglais 🇬🇧',
  French = 'Français 🇫🇷',
  Chinese = 'Chinois 🇨🇳',
  Spanish = 'Espagnol 🇪🇸',
  German = 'Allemand 🇩🇪',
  Italian = 'Italien 🇮🇹',
  Portuguese = 'Portugais 🇵🇹',
  Russian = 'Russe 🇷🇺',
  Japanese = 'Japonais 🇯🇵',
  Korean = 'Coréen 🇰🇷',
  Hindi = 'Hindi 🇮🇳',
  Arabic = 'Arabe 🇸🇦',
  Swahili = 'Swahili 🇰🇪'
}

export enum ExplanationLanguage {
  French = 'Français 🇫🇷',
  Malagasy = 'Malagasy 🇲🇬'
}

export enum LearningMode {
  Course = '📘 Cours structuré',
  Chat = '💬 Discussion libre',
  Practice = '🧪 Pratique & exercices',
  Dialogue = '🎭 Jeux de Rôle'
}

export type LanguageLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | 'HSK 1' | 'HSK 2' | 'HSK 3' | 'HSK 4' | 'HSK 5' | 'HSK 6';

export interface VocabularyItem {
  id: string;
  word: string;
  translation: string;
  example?: string;
  mastered: boolean;
  addedAt: number;
}

export interface UserStats {
  lessonsCompleted: number;
  exercisesCompleted: number;
  dialoguesCompleted: number;
}

export interface UserPreferences {
  targetLanguage: string;
  level: string;
  explanationLanguage: string;
  mode: string;
  voiceName: VoiceName;
  needsAssessment?: boolean;
  history?: Record<string, UserStats>; // Stores progress per language
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

export interface LearningSession {
  id: string; 
  messages: ChatMessage[];
  progress: number;
  score: number;
}

export type NotificationType = 'credit' | 'admin' | 'achievement' | 'system' | 'info' | 'warning';

export interface SmartNotification {
    id: string;
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    read: boolean;
    createdAt: number;
    data?: any;
}

export interface LearningBrainScore {
  pronunciation: number;
  grammar: number;
  vocabulary: number;
  fluency: number;
  structure: number;
  overall: number;
}

export interface LearningProfile {
  brainScore: LearningBrainScore;
  weaknesses: string[];
  strengths: string[];
  lastAnalysisTimestamp: number;
}

export interface LearningMemory {
  masteredVocabulary: string[];
  frequentErrors: string[];
  completedConcepts: string[];
  currentDifficulties: string[];
  lastLesson: string;
  weeklyGoal: string;
  successRate: number;
  lastUpdate: number;
}

export interface UserProfile {
  id: string;
  username: string;
  fullName?: string; // Added for real name support
  email?: string;
  phoneNumber?: string;
  password?: string;
  role: UserRole;
  createdAt: number;
  preferences: UserPreferences | null;
  stats: UserStats;
  vocabulary: VocabularyItem[];
  credits: number;
  xp: number;
  freeUsage?: {
    lastResetWeek: string;
    count: number;
  };
  aiMemory?: LearningMemory; // Changed from string
  isSuspended?: boolean;
  learningProfile?: LearningProfile;
}

export interface AdminRequest {
  id: string;
  userId: string;
  username: string;
  type: 'credit' | 'password_reset' | 'message';
  amount?: number;
  message?: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
}

export interface CouponCode {
  code: string;
  amount: number;
  createdAt: string;
}

export interface SystemSettings {
  apiKeys: string[];
  activeModel: string;
  creditPrice?: number;
  customLanguages?: Array<{code: string, baseName: string, flag: string}>;
  validTransactionRefs?: CouponCode[];
  adminContact: {
    telma: string;
    airtel: string;
    orange: string;
  };
}

export interface LevelDescriptor {
  code: string;
  title: string;
  description: string;
  skills: string[];
  example: string;
}

export interface ExerciseItem {
  id: string;
  type: 'multiple_choice' | 'true_false' | 'fill_blank';
  question: string;
  options?: string[];
  correctAnswer: string;
  explanation: string;
}

export interface ExamResult {
  id: string;
  userId: string;
  language: string;
  level: string;
  score: number;
  totalQuestions: number;
  passed: boolean;
  date: number;
  details: any; // Flexible to store ExamResultDetailed
}

export interface Certificate {
  id: string;
  userId: string;
  userName: string;
  userFullName?: string; // Added for real name
  language: string;
  level: string;
  issueDate: number;
  examId: string;
  validationHash: string;
  qrCodeData: string;
  score: number;
  globalScore?: number;
  skillScores?: {
      reading: number;
      writing: number;
      listening: number;
      speaking: number;
  };
}
