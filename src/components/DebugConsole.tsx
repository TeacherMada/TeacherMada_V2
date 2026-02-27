import React, { useState, useEffect, useRef } from 'react';
import { X, Terminal, Trash2, Copy } from 'lucide-react';

type LogType = 'log' | 'warn' | 'error' | 'info';

interface LogEntry {
  id: string;
  timestamp: string;
  type: LogType;
  message: string;
  details?: any;
}

const DebugConsole: React.FC = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(true); // Visible by default for debugging

  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Enable via URL param ?debug=true
    const params = new URLSearchParams(window.location.search);
    if (params.get('debug') === 'true') {
      setIsVisible(true);
      setIsOpen(true);
    }

    // Enable via triple tap on bottom left corner (simulated by hidden div)
  }, []);

  useEffect(() => {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    const originalInfo = console.info;

    const addLog = (type: LogType, args: any[]) => {
      const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(' ');

      setLogs(prev => [...prev, {
        id: Math.random().toString(36).substr(2, 9),
        timestamp: new Date().toLocaleTimeString(),
        type,
        message
      }].slice(-50)); // Keep last 50 logs
    };

    console.log = (...args) => {
      addLog('log', args);
      originalLog.apply(console, args);
    };

    console.warn = (...args) => {
      addLog('warn', args);
      originalWarn.apply(console, args);
    };

    console.error = (...args) => {
      addLog('error', args);
      originalError.apply(console, args);
    };

    console.info = (...args) => {
      addLog('info', args);
      originalInfo.apply(console, args);
    };

    const handleError = (event: ErrorEvent) => {
      addLog('error', [event.message, event.filename, event.lineno]);
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      addLog('error', ['Unhandled Rejection:', event.reason]);
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);

    return () => {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
      console.info = originalInfo;
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  useEffect(() => {
    if (isOpen && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, isOpen]);

  const copyLogs = () => {
    const text = logs.map(l => `[${l.timestamp}] [${l.type.toUpperCase()}] ${l.message}`).join('\n');
    navigator.clipboard.writeText(text);
    alert('Logs copiés !');
  };

  if (!isVisible) {
      // Invisible trigger area (bottom left)
      return (
          <div 
            className="fixed bottom-0 left-0 w-16 h-16 z-[9999]"
            onClick={(e) => {
                if (e.detail === 3) {
                    setIsVisible(true);
                    setIsOpen(true);
                }
            }}
          />
      );
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 left-4 z-[9999] p-3 bg-black/80 text-green-400 rounded-full shadow-lg border border-green-500/30 backdrop-blur-sm hover:scale-110 transition-transform"
      >
        <Terminal size={20} />
      </button>
    );
  }

  return (
    <div className="fixed inset-x-0 bottom-0 h-[50vh] z-[9999] bg-black/95 text-xs font-mono flex flex-col shadow-2xl border-t border-white/10">
      <div className="flex items-center justify-between p-2 bg-white/5 border-b border-white/10">
        <div className="flex items-center gap-2">
            <span className="text-green-400 font-bold flex items-center gap-2">
                <Terminal size={14} /> Console
            </span>
            <span className="text-white/40">{logs.length} events</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={copyLogs} className="p-1.5 hover:bg-white/10 rounded text-white/70" title="Copier">
            <Copy size={14} />
          </button>
          <button onClick={() => setLogs([])} className="p-1.5 hover:bg-white/10 rounded text-white/70" title="Effacer">
            <Trash2 size={14} />
          </button>
          <button onClick={() => { localStorage.clear(); window.location.reload(); }} className="p-1.5 hover:bg-red-900/50 rounded text-red-400 font-bold text-[10px] px-2" title="Force Logout">
            RESET APP
          </button>
          <button onClick={async () => {
              const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL;
              const supabaseKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY;
              console.log("Testing Connectivity...");
              console.log("URL:", supabaseUrl);
              console.log("Key Length:", supabaseKey?.length);
              
              try {
                  // Test with a real generation request to check if Anon Key has permission
                  const res = await fetch(`${supabaseUrl}/functions/v1/gemini-api`, {
                      method: 'POST',
                      headers: {
                          'Content-Type': 'application/json',
                          'Authorization': `Bearer ${supabaseKey}`,
                          'apikey': supabaseKey
                      },
                      body: JSON.stringify({ 
                          action: 'generate',
                          model: 'gemini-2.5-flash',
                          contents: { parts: [{ text: 'Hello' }] }
                      })
                  });
                  console.log("Status:", res.status);
                  const text = await res.text();
                  console.log("Response:", text);
                  if (res.ok) alert(`Connexion OK ! Réponse: ${text.substring(0, 50)}...`);
                  else alert(`Erreur: ${res.status} ${text}`);
              } catch (e: any) {
                  console.error("Fetch Error:", e);
                  alert(`Erreur Réseau: ${e.message}`);
              }
          }} className="p-1.5 hover:bg-blue-900/50 rounded text-blue-400 font-bold text-[10px] px-2" title="Test Connection">
            TEST CONN
          </button>
          <button onClick={() => setIsOpen(false)} className="p-1.5 hover:bg-white/10 rounded text-white/70">
            <X size={16} />
          </button>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {logs.map((log) => (
          <div key={log.id} className={`break-words border-b border-white/5 pb-1 ${
            log.type === 'error' ? 'text-red-400 bg-red-900/10' :
            log.type === 'warn' ? 'text-yellow-400' :
            'text-white/80'
          }`}>
            <span className="text-white/30 mr-2">[{log.timestamp}]</span>
            <span className="font-bold mr-2 uppercase text-[10px] tracking-wider opacity-70">{log.type}</span>
            <span>{log.message}</span>
          </div>
        ))}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
};

export default DebugConsole;
