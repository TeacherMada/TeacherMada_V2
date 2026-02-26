
import React, { useState, useEffect, useRef, useCallback } from 'react';

// --- DATA ---
const MOCK_USERS = [
  { 
    id: 'u1', name: 'Rindra', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Rindra', 
    lang: 'Chinois 🇨🇳', level: 'HSK 3', 
    message: "你好！Vao nanomboka herinandro aho dia efa mahay miarahaba. Tena mazava be ny lesona eto." 
  },
  { 
    id: 'u2', name: 'Toky', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Toky', 
    lang: 'Allemand 🇩🇪', level: 'B1', 
    message: "Hallo! Mianatra Deutsch aho mba hiasa any Allemagne. Manampy be ilay correction automatique." 
  },
  { 
    id: 'u3', name: 'Soa', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Soa', 
    lang: 'Espagnol 🇪🇸', level: 'A2', 
    message: "¡Hola! Efa sahy miteny Espaniola aho izao. Tiako be ilay fomba fampianarana mivantana." 
  },
  { 
    id: 'u4', name: 'Andry', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Andry', 
    lang: 'Anglais 🇬🇧', level: 'C1', 
    message: "Hello everyone! I'm polishing my Business English here. Tena ilaina amin'ny asako ilay pratique orale." 
  },
  { 
    id: 'u5', name: 'Mialy', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Mialy', 
    lang: 'Français 🇫🇷', level: 'B2', 
    message: "Bonjour ! J'améliore mon français pour mes études. Tsy menatra intsony aho miteny galle." 
  },
  { 
    id: 'u6', name: 'Faly', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Faly', 
    lang: 'Anglais 🇺🇸', level: 'B2', 
    message: "Hi! My pronunciation is getting better every day. Misaotra an'i TeacherMada !" 
  }
];

// --- SUB-COMPONENT: TYPEWRITER MESSAGE ---
const TypewriterMessage = ({ text, onComplete }: { text: string, onComplete: () => void }) => {
    const [displayed, setDisplayed] = useState('');
    const indexRef = useRef(0);

    useEffect(() => {
        const speed = Math.random() * 30 + 30; // Random typing speed between 30ms and 60ms
        
        const timer = setInterval(() => {
            if (indexRef.current < text.length) {
                setDisplayed((prev) => prev + text.charAt(indexRef.current));
                indexRef.current++;
            } else {
                clearInterval(timer);
                onComplete();
            }
        }, speed);

        return () => clearInterval(timer);
    }, [text, onComplete]);

    return <span>{displayed}<span className="animate-pulse">|</span></span>;
};

// --- MAIN COMPONENT ---
const LiveChatDemo: React.FC = () => {
    const [messages, setMessages] = useState<typeof MOCK_USERS>([]);
    const [isTyping, setIsTyping] = useState(false);
    const isMounted = useRef(true);
    const queueIndexRef = useRef(0);

    useEffect(() => {
        isMounted.current = true;
        return () => { isMounted.current = false; };
    }, []);

    const addNextMessage = useCallback(() => {
        if (!isMounted.current) return;
        
        const nextUser = MOCK_USERS[queueIndexRef.current % MOCK_USERS.length];
        queueIndexRef.current++;
        
        setMessages(prevMessages => {
            // Generate a truly unique ID to prevent key collisions
            const uniqueId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            const newHistory = [...prevMessages, { ...nextUser, id: uniqueId }];
            if (newHistory.length > 3) return newHistory.slice(newHistory.length - 3);
            return newHistory;
        });
        
        setIsTyping(true);
    }, []);

    const handleTypingComplete = useCallback(() => {
        if (!isMounted.current) return;
        setIsTyping(false);
        // Wait a bit before starting the next one to simulate reading time
        setTimeout(() => {
            if (isMounted.current) {
                addNextMessage();
            }
        }, 2000);
    }, [addNextMessage]);

    // Initial start
    useEffect(() => {
        const timer = setTimeout(() => {
            if (isMounted.current && messages.length === 0 && !isTyping) {
                addNextMessage();
            }
        }, 500);
        return () => clearTimeout(timer);
    }, [addNextMessage, messages.length, isTyping]);

    return (
        <div className="w-full max-w-md mx-auto relative perspective-1000">
            {/* Decorative background blur */}
            <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500/10 to-purple-500/10 rounded-3xl blur-3xl -z-10"></div>

            <div className="flex flex-col gap-4 min-h-[400px] justify-end p-4">
                {messages.map((msg, idx) => {
                    const isLast = idx === messages.length - 1;
                    return (
                        <div 
                            key={msg.id} 
                            className={`flex gap-3 items-end animate-fade-in-up transition-all duration-500 ${isLast ? 'opacity-100 scale-100' : 'opacity-70 scale-95'}`}
                        >
                            {/* Avatar */}
                            <div className="relative shrink-0">
                                <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700 border-2 border-white dark:border-slate-600 overflow-hidden shadow-md">
                                    <img src={msg.avatar} alt={msg.name} className="w-full h-full object-cover" />
                                </div>
                                <div className="absolute -bottom-1 -right-1 bg-white dark:bg-slate-800 rounded-full p-0.5 shadow-sm">
                                    <div className="w-3 h-3 bg-green-500 rounded-full border-2 border-white dark:border-slate-800"></div>
                                </div>
                            </div>

                            {/* Message Bubble */}
                            <div className="flex-1 bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm p-4 rounded-2xl rounded-bl-none shadow-xl border border-white/20 dark:border-slate-700/50">
                                {/* Header */}
                                <div className="flex justify-between items-center mb-2">
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold text-xs text-slate-800 dark:text-white">{msg.name}</span>
                                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 font-bold border border-indigo-100 dark:border-indigo-800">
                                            {msg.lang}
                                        </span>
                                    </div>
                                    <span className="text-[10px] font-black text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 px-1.5 py-0.5 rounded border border-emerald-100 dark:border-emerald-900/30">
                                        {msg.level}
                                    </span>
                                </div>

                                {/* Content */}
                                <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed font-medium">
                                    {isLast ? (
                                        <TypewriterMessage text={msg.message} onComplete={handleTypingComplete} />
                                    ) : (
                                        msg.message
                                    )}
                                </p>
                            </div>
                        </div>
                    );
                })}
                
                {/* Empty State placeholder to maintain height if needed, though min-h handles it */}
                {messages.length === 0 && (
                    <div className="flex items-center justify-center h-full text-slate-400 text-sm animate-pulse">
                        Connexion au flux des étudiants...
                    </div>
                )}
            </div>
            
            {/* Live Indicator Badge */}
            <div className="absolute -top-4 right-4 bg-white dark:bg-slate-800 px-3 py-1 rounded-full shadow-lg border border-slate-100 dark:border-slate-700 flex items-center gap-2 z-10">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                </span>
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">En Direct</span>
            </div>
        </div>
    );
};

export default LiveChatDemo;
