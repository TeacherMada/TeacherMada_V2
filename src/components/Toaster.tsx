import React, { useState, useEffect } from 'react';
import { X, CheckCircle, AlertCircle, Info as InfoIcon } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

// Simple event bus for toasts
let toastListeners: ((toast: Toast) => void)[] = [];

export const toast = {
  success: (message: string) => {
    const id = Math.random().toString(36).substr(2, 9);
    toastListeners.forEach(l => l({ id, message, type: 'success' }));
  },
  error: (message: string) => {
    const id = Math.random().toString(36).substr(2, 9);
    toastListeners.forEach(l => l({ id, message, type: 'error' }));
  },
  info: (message: string) => {
    const id = Math.random().toString(36).substr(2, 9);
    toastListeners.forEach(l => l({ id, message, type: 'info' }));
  }
};

export const Toaster: React.FC = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const listener = (newToast: Toast) => {
      setToasts(prev => [...prev, newToast]);
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== newToast.id));
      }, 3500);
    };
    toastListeners.push(listener);
    return () => {
      toastListeners = toastListeners.filter(l => l !== listener);
    };
  }, []);

  return (
    <div className="fixed top-6 right-6 z-[300] flex flex-col gap-3 pointer-events-none">
      {toasts.map(t => (
        <div 
          key={t.id} 
          className={`
            flex items-center gap-3 px-5 py-4 rounded-2xl shadow-2xl text-white 
            animate-fade-in-up pointer-events-auto min-w-[280px]
            ${t.type === 'error' ? 'bg-red-500' : t.type === 'success' ? 'bg-emerald-500' : 'bg-indigo-600'}
          `}
        >
          {t.type === 'success' && <CheckCircle size={18} />}
          {t.type === 'error' && <AlertCircle size={18} />}
          {t.type === 'info' && <InfoIcon size={18} />}
          <span className="font-bold text-sm flex-1">{t.message}</span>
          <button 
            onClick={() => setToasts(prev => prev.filter(toast => toast.id !== t.id))}
            className="p-1 hover:bg-white/20 rounded-full transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
};