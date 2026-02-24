import React, { useState, useEffect } from 'react';
import { ExerciseItem, UserProfile, ExamResult, Certificate } from '../types';
import { CheckCircle, XCircle, Clock, Award, AlertTriangle, Download, ArrowRight } from 'lucide-react';
import { storageService } from '../services/storageService';
import jsPDF from 'jspdf';
import { useTranslation } from '../contexts/LanguageContext';

interface SmartExamSessionProps {
  user: UserProfile;
  questions: ExerciseItem[];
  onClose: () => void;
  onComplete: (result: ExamResult) => void;
}

const SmartExamSession: React.FC<SmartExamSessionProps> = ({ user, questions, onClose, onComplete }) => {
  const { t } = useTranslation();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [timeLeft, setTimeLeft] = useState(600); // 10 minutes
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [score, setScore] = useState(0);
  const [passed, setPassed] = useState(false);
  const [certificate, setCertificate] = useState<Certificate | null>(null);

  useEffect(() => {
    if (isSubmitted) return;
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          handleSubmit();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isSubmitted]);

  const handleAnswer = (option: string) => {
    if (isSubmitted) return;
    setAnswers({ ...answers, [questions[currentIndex].id || currentIndex]: option });
  };

  const handleSubmit = () => {
    setIsSubmitted(true);
    let correctCount = 0;
    const details = questions.map((q, idx) => {
      const qId = q.id || idx.toString();
      const isCorrect = answers[qId] === q.correctAnswer;
      if (isCorrect) correctCount++;
      return { questionId: qId, userAnswer: answers[qId], correct: isCorrect };
    });

    const finalScore = (correctCount / questions.length) * 100;
    setScore(finalScore);
    const isPassed = finalScore >= 70;
    setPassed(isPassed);

    const result: ExamResult = {
      id: crypto.randomUUID(),
      userId: user.id,
      language: user.preferences?.targetLanguage || 'Unknown',
      level: user.preferences?.level || 'Unknown',
      score: finalScore,
      totalQuestions: questions.length,
      passed: isPassed,
      date: Date.now(),
      details
    };

    if (isPassed) {
      const certId = crypto.randomUUID();
      const cert: Certificate = {
        id: certId,
        userId: user.id,
        userName: user.username,
        language: user.preferences?.targetLanguage || 'Unknown',
        level: user.preferences?.level || 'Unknown',
        issueDate: Date.now(),
        examId: result.id,
        validationHash: certId,
        qrCodeData: certId,
        score: finalScore,
        globalScore: finalScore,
        skillScores: { reading: finalScore, writing: finalScore, listening: finalScore, speaking: finalScore }
      };
      setCertificate(cert);
      storageService.saveCertificate(cert);
    }
    
    storageService.saveExamResult(result);
    onComplete(result);
  };

  const downloadCertificate = () => {
    if (!certificate) return;
    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4'
    });

    // Background
    doc.setFillColor(248, 250, 252); // Slate-50
    doc.rect(0, 0, 297, 210, 'F');
    
    // Border
    doc.setLineWidth(2);
    doc.setDrawColor(79, 70, 229); // Indigo-600
    doc.rect(10, 10, 277, 190);
    
    // Header
    doc.setFont("helvetica", "bold");
    doc.setFontSize(40);
    doc.setTextColor(30, 41, 59); // Slate-800
    doc.text(t('exam.cert_title'), 148.5, 50, { align: "center" });
    
    // Subheader
    doc.setFontSize(16);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 116, 139); // Slate-500
    doc.text(t('exam.cert_awarded_to'), 148.5, 70, { align: "center" });
    
    // Name
    doc.setFont("times", "italic");
    doc.setFontSize(36);
    doc.setTextColor(79, 70, 229); // Indigo-600
    doc.text(user.username, 148.5, 90, { align: "center" });
    
    // Details
    doc.setFont("helvetica", "normal");
    doc.setFontSize(14);
    doc.setTextColor(51, 65, 85); // Slate-700
    doc.text(t('exam.cert_for_completion'), 148.5, 110, { align: "center" });
    
    doc.setFont("helvetica", "bold");
    doc.setFontSize(24);
    doc.text(`${certificate.level} - ${certificate.language}`, 148.5, 125, { align: "center" });
    
    // Date & ID
    doc.setFontSize(12);
    doc.setFont("courier", "normal");
    doc.setTextColor(148, 163, 184); // Slate-400
    doc.text(`${t('exam.cert_delivered_on')} ${new Date(certificate.issueDate).toLocaleDateString()}`, 148.5, 150, { align: "center" });
    doc.text(`${t('exam.cert_id')} ${certificate.id}`, 148.5, 158, { align: "center" });
    
    // Signature (Mock)
    doc.setLineWidth(0.5);
    doc.line(200, 170, 260, 170);
    doc.setFont("times", "italic");
    doc.setFontSize(12);
    doc.text(t('exam.cert_signature'), 230, 175, { align: "center" });

    doc.save(`TeacherMada_Certificate_${certificate.id}.pdf`);
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  if (isSubmitted) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-900/95 flex items-center justify-center p-4 animate-fade-in">
        <div className="bg-white dark:bg-slate-800 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl">
          <div className={`p-8 text-center ${passed ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
            <div className={`w-24 h-24 mx-auto rounded-full flex items-center justify-center mb-6 ${passed ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}`}>
              {passed ? <Award className="w-12 h-12" /> : <AlertTriangle className="w-12 h-12" />}
            </div>
            
            <h2 className="text-3xl font-black mb-2 dark:text-white">
              {passed ? t('exam.congrats') : t('exam.too_bad')}
            </h2>
            <p className="text-slate-600 dark:text-slate-300 text-lg mb-6">
              {passed 
                ? t('exam.passed_desc', { level: user.preferences?.level || '', score: score.toFixed(0) }) 
                : t('exam.failed_desc', { score: score.toFixed(0) })}
            </p>

            {passed && (
              <button 
                onClick={downloadCertificate}
                className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition-all shadow-lg hover:shadow-emerald-500/30 mb-8"
              >
                <Download className="w-5 h-5" />
                {t('exam.download_cert')}
              </button>
            )}

            {!passed && (
              <button 
                onClick={onClose}
                className="px-6 py-3 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-xl hover:bg-slate-300 transition-colors"
              >
                {t('exam.retry_later')}
              </button>
            )}
          </div>

          <div className="bg-slate-50 dark:bg-slate-900/50 p-6 border-t border-slate-100 dark:border-slate-700 max-h-60 overflow-y-auto">
            <h3 className="font-bold text-slate-500 text-sm uppercase tracking-wider mb-4">{t('exam.details_title')}</h3>
            <div className="space-y-3">
              {questions.map((q, idx) => {
                const qId = q.id || idx.toString();
                const isCorrect = answers[qId] === q.correctAnswer;
                return (
                  <div key={idx} className="flex items-start gap-3 p-3 rounded-lg bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700">
                    {isCorrect ? <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" /> : <XCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />}
                    <div>
                      <p className="text-sm font-medium dark:text-slate-200">{q.question}</p>
                      {!isCorrect && (
                        <p className="text-xs text-slate-500 mt-1">
                          {t('exam.correct_label')} <span className="font-bold text-emerald-600">{q.correctAnswer}</span>
                          <br/>
                          {t('exam.explanation_label')} {q.explanation}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          
          <div className="p-4 bg-slate-50 dark:bg-slate-900 flex justify-end">
             <button onClick={onClose} className="text-slate-500 hover:text-slate-700 font-bold text-sm">{t('exam.close')}</button>
          </div>
        </div>
      </div>
    );
  }

  const currentQ = questions[currentIndex];
  const progress = ((currentIndex + 1) / questions.length) * 100;

  return (
    <div className="fixed inset-0 z-50 bg-slate-50 dark:bg-slate-950 flex flex-col">
      {/* Header */}
      <div className="h-16 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-6 bg-white dark:bg-slate-900">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-black">
            {currentIndex + 1}
          </div>
          <div>
            <h2 className="font-bold text-slate-900 dark:text-white">{t('exam.title')}</h2>
            <p className="text-xs text-slate-500">{user.preferences?.targetLanguage} • {user.preferences?.level}</p>
          </div>
        </div>
        
        <div className={`flex items-center gap-2 font-mono font-bold text-lg ${timeLeft < 60 ? 'text-red-500 animate-pulse' : 'text-slate-700 dark:text-slate-300'}`}>
          <Clock className="w-5 h-5" />
          {formatTime(timeLeft)}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="h-1 bg-slate-100 dark:bg-slate-800 w-full">
        <div className="h-full bg-indigo-600 transition-all duration-500" style={{ width: `${progress}%` }}></div>
      </div>

      {/* Question Area */}
      <div className="flex-1 overflow-y-auto p-6 md:p-12 flex flex-col items-center max-w-4xl mx-auto w-full">
        <div className="w-full bg-white dark:bg-slate-900 rounded-3xl shadow-xl p-8 md:p-12 border border-slate-100 dark:border-slate-800">
          <span className="inline-block px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 text-xs font-bold uppercase tracking-wider mb-6">
            {t('exam.question_progress', { current: currentIndex + 1, total: questions.length })}
          </span>
          
          <h3 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white mb-10 leading-tight">
            {currentQ.question}
          </h3>

          <div className="grid grid-cols-1 gap-4">
            {currentQ.options?.map((opt, idx) => (
              <button
                key={idx}
                onClick={() => handleAnswer(opt)}
                className={`p-6 rounded-2xl text-left font-medium text-lg transition-all border-2 ${
                  answers[currentQ.id || currentIndex] === opt
                    ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 shadow-lg scale-[1.01]'
                    : 'border-slate-100 dark:border-slate-800 hover:border-indigo-200 dark:hover:border-indigo-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300'
                }`}
              >
                <div className="flex items-center gap-4">
                  <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm font-bold ${
                     answers[currentQ.id || currentIndex] === opt ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 text-slate-400'
                  }`}>
                    {String.fromCharCode(65 + idx)}
                  </div>
                  {opt}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Footer Controls */}
      <div className="p-6 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex justify-between items-center max-w-4xl mx-auto w-full">
        <button 
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 font-bold text-sm px-4 py-2"
        >
          {t('exam.abandon')}
        </button>

        <div className="flex gap-4">
          {currentIndex > 0 && (
            <button 
              onClick={() => setCurrentIndex(prev => prev - 1)}
              className="px-6 py-3 rounded-xl font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 transition-colors"
            >
              {t('exam.previous')}
            </button>
          )}
          
          {currentIndex < questions.length - 1 ? (
            <button 
              onClick={() => setCurrentIndex(prev => prev + 1)}
              disabled={!answers[currentQ.id || currentIndex]}
              className="px-8 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl shadow-lg shadow-indigo-500/20 transition-all flex items-center gap-2"
            >
              {t('exam.next')} <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button 
              onClick={handleSubmit}
              disabled={Object.keys(answers).length < questions.length}
              className="px-8 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl shadow-lg shadow-emerald-500/20 transition-all flex items-center gap-2"
            >
              {t('exam.finish')} <CheckCircle className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default SmartExamSession;
