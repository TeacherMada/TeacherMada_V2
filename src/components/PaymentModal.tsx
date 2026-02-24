
import React, { useState, useEffect } from 'react';
import { X, Smartphone, Calculator, ArrowRight, Send, CheckCircle, Copy, Check, Coins, Ticket, Loader2, ChevronLeft, AlertTriangle, Hash, Wifi, Sparkles, TrendingUp } from 'lucide-react';
import { ADMIN_CONTACTS, CREDIT_PRICE_ARIARY } from '../constants';
import { storageService } from '../services/storageService';
import { UserProfile } from '../types';
import { useTranslation } from '../contexts/LanguageContext';

interface PaymentModalProps {
  onClose: () => void;
  user: UserProfile;
}

const PRESET_AMOUNTS = [1000, 2000, 5000, 10000];

// Codes USSD mis à jour selon la demande
const OPERATOR_THEMES = {
    mvola: { color: 'bg-yellow-500', ussd: '#111*1*2#', text: 'text-yellow-600', bg: 'bg-yellow-50', border: 'border-yellow-200' },
    airtel: { color: 'bg-red-500', ussd: '*436*2*1#', text: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' },
    orange: { color: 'bg-orange-500', ussd: '#144#', text: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200' }
};

const PaymentModal: React.FC<PaymentModalProps> = ({ onClose, user }) => {
  const { t } = useTranslation();
  if (!user) return null;

  const [activeTab, setActiveTab] = useState<'money' | 'coupon'>('money');
  
  // Mobile Money State
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [amount, setAmount] = useState<string>('2000');
  const [selectedOperator, setSelectedOperator] = useState<'mvola' | 'airtel' | 'orange'>('mvola');
  const [reference, setReference] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Tooltip State
  const [showInputGuide, setShowInputGuide] = useState(false);

  // Coupon State
  const [couponCode, setCouponCode] = useState('');
  const [couponStatus, setCouponStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [couponMessage, setCouponMessage] = useState('');

  // Derived
  const numericAmount = parseInt(amount.replace(/\D/g, '') || '0');
  const credits = Math.floor(numericAmount / CREDIT_PRICE_ARIARY);
  const cleanUsername = user.username.replace(/[^a-zA-Z0-9]/g, '');
  const motifCode = `Crd_${cleanUsername}`.substring(0, 15);

  const currentTheme = OPERATOR_THEMES[selectedOperator];

  // Effect for Input Tooltip (Visible for 10s)
  useEffect(() => {
      if (activeTab === 'money' && step === 1) {
          setShowInputGuide(true);
          const timer = setTimeout(() => {
              setShowInputGuide(false);
          }, 10000); // Disparaît après 10 secondes
          return () => clearTimeout(timer);
      } else {
          setShowInputGuide(false);
      }
  }, [activeTab, step]);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleAmountSelect = (val: number) => {
    setAmount(val.toString());
    setShowInputGuide(false); // Hide tooltip if user interacts
  };

  const handleMoneySubmit = async () => {
    if (!reference.trim()) return;
    setIsSubmitting(true);
    
    try {
      await storageService.sendAdminRequest(
        user.id,
        user.username,
        'credit',
        credits,
        `Mobile Money (${selectedOperator.toUpperCase()}). Réf: ${reference}`,
        user.phoneNumber || '' 
      );
      setIsSuccess(true);
      setTimeout(() => {
        onClose();
      }, 3000);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCouponSubmit = async () => {
    if (!couponCode.trim()) return;
    setCouponStatus('loading');
    
    try {
      const result = await storageService.redeemCode(user.id, couponCode.trim());
      if (result.success) {
        setCouponStatus('success');
        setCouponMessage(`+${result.amount} ${t('payment.credits_added')}`);
        setTimeout(() => {
            window.location.reload(); 
        }, 2000);
      } else {
        setCouponStatus('error');
        setCouponMessage(result.message || t('payment.invalid_code'));
      }
    } catch (e) {
      setCouponStatus('error');
      setCouponMessage(t('common.connection_error'));
    }
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-end sm:items-center justify-center pointer-events-none">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm pointer-events-auto transition-opacity animate-fade-in" 
        onClick={onClose}
      />

      {/* Modal Container */}
      <div className="bg-white dark:bg-[#0F1422] w-full sm:max-w-md h-[90vh] sm:h-auto sm:max-h-[85vh] rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl pointer-events-auto flex flex-col overflow-hidden animate-slide-up border border-slate-200 dark:border-slate-800">
        
        {/* Header Gradient */}
        <div className="bg-gradient-to-r from-indigo-600 to-violet-600 p-6 pb-8 relative shrink-0">
            <div className="flex items-center justify-between mb-4 relative z-10">
                {/* Left */}
                <h2 className="text-lg font-black text-white tracking-tight">{t('payment.title')}</h2>
                
                {/* Center */}
                <div className="flex flex-col items-center">
                     <span className="text-[10px] text-indigo-200 font-bold uppercase tracking-widest mb-0.5">{t('payment.current_balance')}</span>
                     <div className="flex items-center gap-1.5 bg-white/20 px-3 py-1 rounded-full backdrop-blur-sm border border-white/10">
                        <TrendingUp className="w-3 h-3 text-amber-300" />
                        <span className="text-sm font-black text-white">{user.credits} CRD</span>
                     </div>
                </div>

                {/* Right */}
                <button onClick={onClose} className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors">
                    <X className="w-5 h-5" />
                </button>
            </div>

            {/* Floating Tabs */}
            <div className="absolute -bottom-6 left-6 right-6 h-12 bg-white dark:bg-slate-800 rounded-2xl shadow-xl flex p-1 border border-slate-100 dark:border-slate-700">
                <button 
                    onClick={() => setActiveTab('money')}
                    className={`flex-1 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all ${activeTab === 'money' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
                >
                    <Smartphone className="w-4 h-4" /> {t('payment.mobile_money')}
                </button>
                <button 
                    onClick={() => setActiveTab('coupon')}
                    className={`flex-1 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all ${activeTab === 'coupon' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
                >
                    <Ticket className="w-4 h-4" /> {t('payment.coupon')}
                </button>
            </div>
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-6 pt-10 scrollbar-hide">
            
            {/* --- TAB: MOBILE MONEY --- */}
            {activeTab === 'money' && !isSuccess && (
                <div className="space-y-6">
                    {/* Step Indicator */}
                    <div className="flex items-center justify-between mb-2 px-2">
                        <div className={`h-1.5 flex-1 rounded-full transition-colors ${step >= 1 ? 'bg-indigo-500' : 'bg-slate-100 dark:bg-slate-800'}`}></div>
                        <div className="w-2"></div>
                        <div className={`h-1.5 flex-1 rounded-full transition-colors ${step >= 2 ? 'bg-indigo-500' : 'bg-slate-100 dark:bg-slate-800'}`}></div>
                        <div className="w-2"></div>
                        <div className={`h-1.5 flex-1 rounded-full transition-colors ${step >= 3 ? 'bg-indigo-500' : 'bg-slate-100 dark:bg-slate-800'}`}></div>
                    </div>

                    {/* STEP 1: AMOUNT */}
                    {step === 1 && (
                        <div className="space-y-6 animate-fade-in pt-4">
                            
                            <div className="text-center space-y-4 pt-2">
                                <div className="relative max-w-[240px] mx-auto group">
                                    
                                    {/* TOOLTIP 10s VISIBILITY */}
                                    {showInputGuide && (
                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 w-max z-30 animate-bounce-slight pointer-events-none">
                                            <div className="bg-amber-500 text-white text-xs font-bold px-4 py-2 rounded-xl shadow-xl relative flex items-center gap-2">
                                                <span>{t('payment.tooltip_amount')}</span>
                                                <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-amber-500"></div>
                                            </div>
                                        </div>
                                    )}

                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">{t('payment.recharge_here')}</label>
                                    <div className="relative">
                                        <input 
                                            type="number" 
                                            value={amount}
                                            onChange={(e) => { setAmount(e.target.value); setShowInputGuide(false); }}
                                            className="w-full bg-slate-50 dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-4 text-center text-3xl font-black text-slate-800 dark:text-white outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all placeholder:text-slate-300"
                                            placeholder="0"
                                        />
                                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">Ar</span>
                                    </div>
                                </div>
                                
                                <div className="inline-flex items-center gap-2 bg-emerald-50 dark:bg-emerald-900/20 px-4 py-2 rounded-full border border-emerald-100 dark:border-emerald-800/30">
                                    <Coins className="w-4 h-4 text-emerald-500"/>
                                    <span className="font-bold text-emerald-700 dark:text-emerald-400 text-sm">= {credits} {t('common.credits')}</span>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                {PRESET_AMOUNTS.map(amt => (
                                    <button 
                                        key={amt} 
                                        onClick={() => handleAmountSelect(amt)}
                                        className={`p-3 rounded-xl border-2 font-bold text-sm transition-all ${parseInt(amount) === amt ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300' : 'border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:border-slate-300'}`}
                                    >
                                        {amt.toLocaleString()} Ar
                                    </button>
                                ))}
                            </div>

                            <button onClick={() => setStep(2)} disabled={numericAmount < 500} className="w-full py-4 bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold rounded-2xl flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] transition-transform shadow-lg">
                                {t('common.continue')} <ArrowRight className="w-5 h-5" />
                            </button>
                        </div>
                    )}

                    {/* STEP 2: OPERATOR & GUIDE */}
                    {step === 2 && (
                        <div className="space-y-6 animate-slide-in-right">
                            <button onClick={() => setStep(1)} className="text-xs font-bold text-slate-400 flex items-center gap-1 hover:text-indigo-500"><ChevronLeft className="w-4 h-4"/> {t('common.back')}</button>
                            
                            {/* Operator Selector */}
                            <div className="grid grid-cols-3 gap-3">
                                <OperatorMiniBtn name="MVola" active={selectedOperator === 'mvola'} color="bg-yellow-500" onClick={() => setSelectedOperator('mvola')} />
                                <OperatorMiniBtn name="Airtel" active={selectedOperator === 'airtel'} color="bg-red-500" onClick={() => setSelectedOperator('airtel')} />
                                <OperatorMiniBtn name="Orange" active={selectedOperator === 'orange'} color="bg-orange-500" onClick={() => setSelectedOperator('orange')} />
                            </div>

                            {/* Intelligent Guide Card */}
                            <div className={`rounded-2xl border-2 overflow-hidden ${currentTheme.border} ${currentTheme.bg} bg-opacity-20`}>
                                <div className={`px-4 py-2 ${currentTheme.bg} flex items-center justify-between`}>
                                    <span className={`text-xs font-black uppercase tracking-wider ${currentTheme.text} flex items-center gap-1`}>
                                        <Smartphone className="w-3 h-3" /> {t('payment.guide_operator', { operator: selectedOperator })}
                                    </span>
                                    <span className="font-bold bg-indigo-600 text-white px-2 py-0.5 rounded text-[10px]">Code: {currentTheme.ussd}</span>
                                </div>
                                
                                <div className="p-4 space-y-4">
                                    {/* Instruction Row 1 */}
                                    <div className="flex items-start gap-3">
                                        <div className="w-6 h-6 rounded-full bg-white flex items-center justify-center font-bold text-xs shadow-sm shrink-0 border border-slate-100">1</div>
                                        <div className="text-sm w-full">
                                            <p className="text-slate-600 dark:text-slate-300"><strong className="text-slate-900 dark:text-white">{t('payment.send_money_instruction', { amount: amount })}</strong></p>
                                            <div className="flex flex-col gap-2 mt-1">
                                                 <div className="flex flex-wrap items-center gap-2">
                                                     <button onClick={() => copyToClipboard(ADMIN_CONTACTS[selectedOperator === 'mvola' ? 'telma' : selectedOperator], 'num')} className="flex items-center gap-2 bg-white dark:bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm font-mono font-bold text-slate-800 dark:text-white w-fit active:scale-95 transition-transform">
                                                        {ADMIN_CONTACTS[selectedOperator === 'mvola' ? 'telma' : selectedOperator]}
                                                        {copiedKey === 'num' ? <Check className="w-3 h-3 text-emerald-500"/> : <Copy className="w-3 h-3 text-slate-400"/>}
                                                    </button>
                                                    <span className="text-xs font-bold text-slate-500 uppercase">TSANTA FIDERANA</span>
                                                 </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Instruction Row 2 (Critical) */}
                                    <div className="flex items-start gap-3 relative overflow-hidden">
                                        {/* Animated pulse background for emphasis */}
                                        <div className="absolute inset-0 bg-indigo-500/5 animate-pulse rounded-lg -z-10"></div>
                                        <div className="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-xs shadow-sm shrink-0 mt-1">2</div>
                                        <div className="text-sm">
                                            <p className="text-slate-600 dark:text-slate-300 font-medium">
                                                {t('payment.add_motif_instruction')}
                                            </p>
                                            <button onClick={() => copyToClipboard(motifCode, 'motif')} className="mt-1.5 flex items-center gap-2 bg-indigo-600 text-white px-3 py-2 rounded-lg shadow-md shadow-indigo-500/30 font-mono font-bold w-full justify-between hover:bg-indigo-700 active:scale-95 transition-all group">
                                                <span>{motifCode}</span>
                                                {copiedKey === 'motif' ? <Check className="w-4 h-4 text-emerald-300"/> : <Copy className="w-4 h-4 text-indigo-200 group-hover:text-white"/>}
                                            </button>
                                            <p className="text-[10px] text-slate-400 mt-1 italic">{t('payment.motif_explanation')}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <button onClick={() => setStep(3)} className="w-full py-4 bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold rounded-2xl flex items-center justify-center gap-2 hover:scale-[1.02] transition-transform shadow-lg">
                                {t('payment.sent_money')} <ArrowRight className="w-5 h-5" />
                            </button>
                        </div>
                    )}

                    {/* STEP 3: CONFIRM */}
                    {step === 3 && (
                        <div className="space-y-6 animate-slide-in-right">
                            <button onClick={() => setStep(2)} className="text-xs font-bold text-slate-400 flex items-center gap-1 hover:text-indigo-500"><ChevronLeft className="w-4 h-4"/> {t('common.back')}</button>
                            
                            <div className="text-center">
                                <div className="w-16 h-16 bg-indigo-50 dark:bg-indigo-900/20 rounded-full flex items-center justify-center mx-auto mb-4 text-indigo-600">
                                    <Smartphone className="w-8 h-8" />
                                </div>
                                <h3 className="text-xl font-bold text-slate-800 dark:text-white">{t('payment.last_step')}</h3>
                                <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 px-4">{t('payment.enter_reference_desc', { credits: credits })}</p>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-500 uppercase ml-2">{t('payment.reference_label')}</label>
                                <textarea 
                                    rows={2}
                                    value={reference}
                                    onChange={(e) => setReference(e.target.value)}
                                    placeholder={t('payment.reference_placeholder')}
                                    className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white text-sm font-medium"
                                />
                            </div>

                            <button 
                                onClick={handleMoneySubmit} 
                                disabled={!reference.trim() || isSubmitting}
                                className="w-full py-4 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold rounded-2xl flex items-center justify-center gap-2 hover:shadow-lg disabled:opacity-70 transition-all active:scale-95"
                            >
                                {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin"/> : <Send className="w-5 h-5" />}
                                {t('payment.validate_credits')}
                            </button>
                        </div>
                    )}
                </div>
            )}

            {isSuccess && (
                <div className="flex flex-col items-center justify-center h-full text-center space-y-6 animate-scale-in">
                    <div className="w-24 h-24 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center border-4 border-emerald-50 dark:border-emerald-900/50">
                        <CheckCircle className="w-12 h-12 text-emerald-500" />
                    </div>
                    <div>
                        <h3 className="text-2xl font-black text-slate-900 dark:text-white">{t('payment.request_sent')}</h3>
                        <p className="text-slate-500 dark:text-slate-400 mt-2">{t('payment.admin_validation_desc')}</p>
                    </div>
                </div>
            )}

            {/* --- TAB: COUPON --- */}
            {activeTab === 'coupon' && (
                <div className="flex flex-col h-full justify-center space-y-8 animate-fade-in pb-10">
                    <div className="text-center">
                        <div className="w-20 h-20 bg-indigo-50 dark:bg-slate-800 rounded-3xl rotate-3 mx-auto mb-6 flex items-center justify-center shadow-sm">
                            <Ticket className="w-10 h-10 text-indigo-500" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white">{t('payment.have_code')}</h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">{t('payment.enter_code_desc')}</p>
                    </div>

                    <div className="space-y-4">
                        <input 
                            type="text" 
                            placeholder={t('payment.code_placeholder')}
                            value={couponCode}
                            onChange={(e) => { setCouponCode(e.target.value.toUpperCase()); setCouponStatus('idle'); }}
                            className="w-full text-center text-2xl font-black tracking-widest p-5 rounded-2xl bg-slate-50 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 outline-none focus:border-indigo-500 uppercase placeholder:text-slate-300 dark:placeholder:text-slate-600 transition-colors dark:text-white"
                            disabled={couponStatus === 'loading' || couponStatus === 'success'}
                        />
                        
                        {couponStatus === 'error' && (
                            <div className="flex items-center justify-center gap-2 text-red-500 text-sm font-bold bg-red-50 dark:bg-red-900/20 p-3 rounded-xl animate-shake">
                                <AlertTriangle className="w-4 h-4"/> {couponMessage}
                            </div>
                        )}
                        {couponStatus === 'success' && (
                            <div className="flex items-center justify-center gap-2 text-emerald-600 text-sm font-bold bg-emerald-50 dark:bg-emerald-900/20 p-3 rounded-xl animate-bounce-slight">
                                <CheckCircle className="w-4 h-4"/> {couponMessage}
                            </div>
                        )}

                        <button 
                            onClick={handleCouponSubmit}
                            disabled={!couponCode.trim() || couponStatus === 'loading' || couponStatus === 'success'}
                            className="w-full py-4 bg-indigo-600 text-white font-bold rounded-2xl shadow-lg shadow-indigo-500/20 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {couponStatus === 'loading' ? <Loader2 className="w-5 h-5 animate-spin"/> : t('payment.validate_code')}
                        </button>
                    </div>
                </div>
            )}

        </div>
      </div>
    </div>
  );
};

const OperatorMiniBtn = ({ name, active, color, onClick }: any) => (
    <button 
        onClick={onClick}
        className={`p-3 rounded-xl border-2 flex flex-col items-center gap-1 transition-all ${active ? `border-${color.split('-')[1]}-500 bg-white dark:bg-slate-800 shadow-md transform scale-105` : 'border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 opacity-60 hover:opacity-100'}`}
    >
        <div className={`w-3 h-3 rounded-full ${color}`}></div>
        <span className={`text-xs font-bold ${active ? 'text-slate-900 dark:text-white' : 'text-slate-500'}`}>{name}</span>
    </button>
);

export default PaymentModal;
