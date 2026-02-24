
export type ExamType = 'diagnostic' | 'certification';

export interface ExamSection {
    id: string;
    type: 'qcm' | 'writing' | 'listening' | 'speaking';
    question: string;
    options?: string[]; // For QCM
    context?: string; // Text to read or listen to
    audioUrl?: string; // For listening
    weight: number; // 1-10
}

export interface SmartExam {
    id: string;
    type: ExamType;
    targetLevel: string;
    language: string;
    sections: ExamSection[];
    totalQuestions: number;
    createdAt: number;
}

export interface ExamResultDetailed {
    examId: string;
    userId: string;
    userName: string;
    userFullName?: string; // Added for certificate
    language?: string;
    date: number;
    globalScore: number; // 0-100
    skillScores: {
        reading: number;
        writing: number;
        listening: number;
        speaking: number;
    };
    detectedLevel: string;
    passed: boolean;
    certificateId?: string;
    feedback: string;
    confidenceScore: number; // 0-100
}

export interface CertificateMetadata {
    id: string;
    userId: string;
    userName: string;
    userFullName?: string; // Added for certificate
    level: string;
    language: string;
    issueDate: number;
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
