import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCcw, Home } from 'lucide-react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-6 text-center font-sans">
          <div className="w-20 h-20 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mb-6 animate-bounce">
            <AlertTriangle className="w-10 h-10 text-red-500" />
          </div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white mb-2">Oups ! Une erreur est survenue.</h1>
          <p className="text-slate-500 dark:text-slate-400 mb-8 max-w-xs mx-auto text-sm">
            L'application a rencontré un problème inattendu. Ne vous inquiétez pas, aucune donnée n'a été perdue.
          </p>
          
          <div className="flex gap-4">
            <button 
              onClick={() => window.location.reload()}
              className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white font-bold rounded-xl shadow-lg hover:bg-indigo-700 transition-all active:scale-95"
            >
              <RefreshCcw className="w-4 h-4" /> Recharger
            </button>
            <button 
                onClick={() => {
                    localStorage.removeItem('tm_v3_session_active'); // Try to clear potential bad state
                    window.location.href = '/';
                }}
                className="flex items-center gap-2 px-6 py-3 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 hover:bg-slate-50 transition-all"
            >
                <Home className="w-4 h-4" /> Accueil
            </button>
          </div>
          
          {this.state.error && (
              <details className="mt-8 text-xs text-slate-400 max-w-md text-left bg-slate-100 dark:bg-slate-900 p-4 rounded-lg overflow-auto max-h-32 w-full">
                  <summary className="cursor-pointer font-bold mb-1">Détails techniques</summary>
                  {this.state.error.toString()}
              </details>
          )}
        </div>
      );
    }

    // Cast 'this' to any to bypass the TypeScript error about 'props' missing on 'ErrorBoundary'
    return (this as any).props.children;
  }
}

export default ErrorBoundary;