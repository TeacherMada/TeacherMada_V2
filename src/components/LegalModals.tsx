import React from 'react';
import { X, Shield, FileText } from 'lucide-react';
import { useTranslation } from '../contexts/LanguageContext';

interface LegalModalProps {
  type: 'privacy' | 'terms' | null;
  onClose: () => void;
}

const LegalModal: React.FC<LegalModalProps> = ({ type, onClose }) => {
  const { t } = useTranslation();
  if (!type) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-slate-900 w-full max-w-2xl max-h-[80vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden relative">
        
        {/* Header */}
        <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-white dark:bg-slate-900 z-10">
            <div className="flex items-center gap-3">
                <div className={`p-2 rounded-xl ${type === 'privacy' ? 'bg-emerald-100 text-emerald-600' : 'bg-blue-100 text-blue-600'}`}>
                    {type === 'privacy' ? <Shield className="w-6 h-6"/> : <FileText className="w-6 h-6"/>}
                </div>
                <h2 className="text-xl font-black text-slate-900 dark:text-white">
                    {type === 'privacy' ? t('legal.privacy_title') : t('legal.terms_title')}
                </h2>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors">
                <X className="w-6 h-6 text-slate-500" />
            </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8 text-sm text-slate-600 dark:text-slate-300 leading-relaxed space-y-6 font-medium">
            {type === 'privacy' ? (
                <>
                    <p><strong>{t('legal.privacy_content_1')}</strong></p>
                    <p>{t('legal.privacy_content_2')}</p>
                    
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white mt-4">{t('legal.privacy_section_1_title')}</h3>
                    <p>{t('legal.privacy_section_1_desc')}</p>
                    <ul className="list-disc pl-5 space-y-1">
                        <li>{t('legal.privacy_section_1_li_1')}</li>
                        <li>{t('legal.privacy_section_1_li_2')}</li>
                    </ul>

                    <h3 className="text-lg font-bold text-slate-900 dark:text-white mt-4">{t('legal.privacy_section_2_title')}</h3>
                    <p>{t('legal.privacy_section_2_desc')}</p>

                    <h3 className="text-lg font-bold text-slate-900 dark:text-white mt-4">{t('legal.privacy_section_3_title')}</h3>
                    <p>{t('legal.privacy_section_3_desc')}</p>
                </>
            ) : (
                <>
                    <p><strong>{t('legal.terms_content_1')}</strong></p>
                    
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white mt-4">{t('legal.terms_section_1_title')}</h3>
                    <p>{t('legal.terms_section_1_desc')}</p>

                    <h3 className="text-lg font-bold text-slate-900 dark:text-white mt-4">{t('legal.terms_section_2_title')}</h3>
                    <p>{t('legal.terms_section_2_desc')}</p>

                    <h3 className="text-lg font-bold text-slate-900 dark:text-white mt-4">{t('legal.terms_section_3_title')}</h3>
                    <p>{t('legal.terms_section_3_desc')}</p>

                    <h3 className="text-lg font-bold text-slate-900 dark:text-white mt-4">{t('legal.terms_section_4_title')}</h3>
                    <p>{t('legal.terms_section_4_desc')}</p>
                </>
            )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50">
            <button onClick={onClose} className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all">
                {t('legal.accept_close')}
            </button>
        </div>
      </div>
    </div>
  );
};

export default LegalModal;
