import React, { useState, useEffect } from 'react';
import { Mic, Phone, X, MessageCircle, Sparkles, Check, Award, Star, ShieldCheck, Play, Pause, BarChart3, Zap, Brain, ArrowRight, Linkedin, Share2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// --- 1. Live Voice Call Section ---
export const LiveVoiceSection = ({ onStart }: { onStart: () => void }) => {
  const [isCalling, setIsCalling] = useState(true);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setDuration(d => d + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <section className="py-24 bg-slate-900 text-white overflow-hidden relative">
      {/* Background Elements */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-600/20 rounded-full blur-[100px] animate-pulse-slow"></div>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-600/20 rounded-full blur-[100px] animate-pulse-slow delay-1000"></div>
      </div>

      <div className="max-w-7xl mx-auto px-6 relative z-10 grid lg:grid-cols-2 gap-16 items-center">
        
        {/* Text Content */}
        <div className="order-2 lg:order-1">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 text-xs font-bold uppercase tracking-wider mb-6">
            <Mic className="w-3 h-3" /> Live Conversation
          </div>
          <h2 className="text-4xl md:text-5xl font-black mb-6 leading-tight">
            Parlez. <br/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400">On vous écoute.</span>
          </h2>
          <p className="text-lg text-slate-400 mb-8 leading-relaxed">
            Plus de scénarios rigides. Discutez naturellement avec TeacherMada. 
            Il comprend votre accent, corrige vos fautes en temps réel et s'adapte à votre niveau.
            C'est comme avoir un prof natif dans votre poche.
          </p>
          
          <button 
            onClick={onStart}
            className="group relative px-8 py-4 bg-white text-slate-900 rounded-2xl font-black text-lg shadow-xl hover:shadow-2xl hover:scale-105 transition-all flex items-center gap-3 overflow-hidden"
          >
            <span className="relative z-10 flex items-center gap-2">
              <Mic className="w-5 h-5 text-indigo-600" />
              Essayer un appel maintenant
            </span>
            <div className="absolute inset-0 bg-gradient-to-r from-indigo-50 to-white opacity-0 group-hover:opacity-100 transition-opacity"></div>
          </button>
        </div>

        {/* Phone UI Demo */}
        <div className="order-1 lg:order-2 flex justify-center">
          <div className="relative w-[320px] h-[640px] bg-slate-950 rounded-[3rem] border-8 border-slate-800 shadow-2xl overflow-hidden ring-1 ring-white/10">
            {/* Screen Content */}
            <div className="absolute inset-0 bg-gradient-to-b from-slate-900 to-slate-950 flex flex-col items-center pt-16 pb-8 px-6">
              
              {/* Caller Info */}
              <div className="flex flex-col items-center mb-12">
                <div className="w-24 h-24 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 p-1 mb-4 shadow-lg shadow-indigo-500/30 relative">
                   <img src="https://i.ibb.co/B2XmRwmJ/logo.png" className="w-full h-full object-cover rounded-full bg-slate-900" alt="TeacherMada" />
                   <div className="absolute bottom-1 right-1 w-5 h-5 bg-emerald-500 border-4 border-slate-900 rounded-full"></div>
                </div>
                <h3 className="text-2xl font-bold text-white mb-1">TeacherMada</h3>
                <p className="text-indigo-400 font-medium animate-pulse">Appel en cours...</p>
                <p className="text-slate-500 text-sm mt-1 font-mono">{formatTime(duration)}</p>
              </div>

              {/* Waveform Animation */}
              <div className="flex-1 w-full flex items-center justify-center gap-1 mb-12">
                {[...Array(8)].map((_, i) => (
                  <div 
                    key={i} 
                    className="w-2 bg-indigo-500/80 rounded-full animate-wave"
                    style={{ 
                      height: '40px',
                      animationDelay: `${i * 0.1}s`,
                      animationDuration: '1s' 
                    }}
                  ></div>
                ))}
              </div>

              {/* Controls */}
              <div className="w-full grid grid-cols-3 gap-4 place-items-center">
                <button className="w-14 h-14 rounded-full bg-slate-800/50 flex items-center justify-center text-white hover:bg-slate-800 transition-colors">
                  <Mic className="w-6 h-6" />
                </button>
                <button 
                  onClick={onStart}
                  className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center text-white shadow-lg shadow-red-500/30 hover:bg-red-600 transition-colors transform hover:scale-110"
                >
                  <Phone className="w-8 h-8 rotate-[135deg]" />
                </button>
                <button className="w-14 h-14 rounded-full bg-slate-800/50 flex items-center justify-center text-white hover:bg-slate-800 transition-colors">
                  <MessageCircle className="w-6 h-6" />
                </button>
              </div>

            </div>
            
            {/* Notch */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-7 bg-slate-800 rounded-b-2xl z-20"></div>
          </div>
        </div>

      </div>
      
      <style>{`
        @keyframes wave {
          0%, 100% { height: 10px; opacity: 0.5; }
          50% { height: 60px; opacity: 1; }
        }
        .animate-wave {
          animation: wave 1s ease-in-out infinite;
        }
      `}</style>
    </section>
  );
};

// --- 2. Dynamic Dialogues Section ---
export const DynamicDialoguesSection = () => {
  const [visibleMessages, setVisibleMessages] = useState<number>(0);
  
  // Scénario : Anglais Pro avec explications Malagasy
  const conversation = [
    { 
      role: 'user', 
      text: "I send the report yesterday to the boss.",
      isError: true 
    },
    { 
      role: 'ai', 
      text: "Attention au passé ! 🕒 On dit : \"I **sent** the report yesterday.\"",
      isCorrection: true
    },
    { 
      role: 'ai', 
      text: "Ny 'send' dia irregular verb. Lasa 'sent' izy rehefa amin'ny lasa (Past Simple). 📝",
      isExplanation: true
    },
    { 
      role: 'user', 
      text: "Ah okay! I sent the report yesterday." 
    },
    { 
      role: 'ai', 
      text: "Tsara be ! (Excellent !) C'est beaucoup plus professionnel. 🌟" 
    }
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setVisibleMessages(prev => {
        if (prev < conversation.length) return prev + 1;
        return prev;
      });
    }, 2500); // Rythme de lecture naturel
    return () => clearInterval(interval);
  }, []);

  return (
    <section className="py-24 bg-slate-50 dark:bg-[#0B0F19] overflow-hidden relative">
      {/* Background Decor */}
      <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-indigo-500/5 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>

      <div className="max-w-7xl mx-auto px-6 grid lg:grid-cols-2 gap-16 items-center relative z-10">
        
        {/* Left: Value Proposition */}
        <div className="text-left">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 text-xs font-bold uppercase tracking-wider mb-6">
            <Sparkles className="w-3 h-3" /> Intelligence Artificielle Avancée
          </div>
          
          <h2 className="text-4xl md:text-5xl font-black text-slate-900 dark:text-white mb-6 leading-tight">
            Plus qu'une app.<br/>
            <span className="text-indigo-600 dark:text-indigo-400">Un vrai tuteur privé.</span>
          </h2>
          
          <p className="text-lg text-slate-600 dark:text-slate-400 mb-8 leading-relaxed">
            Ne vous contentez pas de répéter des phrases. <strong>TeacherMada</strong> analyse votre grammaire, corrige vos erreurs et vous explique les nuances <span className="text-indigo-600 dark:text-indigo-400 font-bold">en Malagasy</span>.
          </p>

          <ul className="space-y-4 mb-10">
            {[
              "Corrections instantanées et précises",
              "Explications claires en Malagasy",
              "Adapté au contexte professionnel",
              "Disponible 24h/24 et 7j/7"
            ].map((item, i) => (
              <li key={i} className="flex items-center gap-3 text-slate-700 dark:text-slate-300 font-medium">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                  <Check className="w-3.5 h-3.5" />
                </div>
                {item}
              </li>
            ))}
          </ul>

          <button className="group px-8 py-4 bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold rounded-2xl shadow-xl hover:shadow-2xl hover:-translate-y-1 transition-all flex items-center gap-3">
            Commencer maintenant
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </button>
        </div>

        {/* Right: Chat Simulation */}
        <div className="relative">
          {/* Phone/Card Container */}
          <div className="relative bg-white dark:bg-slate-800 rounded-[2.5rem] shadow-2xl border border-slate-200 dark:border-slate-700 p-4 md:p-6 max-w-md mx-auto transform rotate-1 hover:rotate-0 transition-transform duration-500">
            
            {/* Header */}
            <div className="flex items-center gap-4 border-b border-slate-100 dark:border-slate-700 pb-4 mb-6 px-2">
              <div className="relative">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 p-0.5">
                  <img src="https://i.ibb.co/B2XmRwmJ/logo.png" className="w-full h-full object-cover rounded-full bg-white dark:bg-slate-900" alt="TeacherMada" />
                </div>
                <div className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-emerald-500 border-2 border-white dark:border-slate-800 rounded-full"></div>
              </div>
              <div>
                <h3 className="font-bold text-lg text-slate-900 dark:text-white">TeacherMada</h3>
                <p className="text-xs text-indigo-500 font-medium flex items-center gap-1">
                  Typing...
                </p>
              </div>
            </div>

            {/* Messages */}
            <div className="space-y-4 min-h-[400px]">
              {conversation.map((msg, idx) => (
                <div 
                  key={idx}
                  className={`transition-all duration-500 ${
                    idx < visibleMessages 
                      ? 'opacity-100 translate-y-0' 
                      : 'opacity-0 translate-y-4 absolute'
                  }`}
                >
                  <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div 
                      className={`max-w-[85%] p-4 rounded-2xl text-sm md:text-[15px] leading-relaxed shadow-sm ${
                        msg.role === 'user' 
                          ? 'bg-indigo-600 text-white rounded-tr-sm' 
                          : (msg as any).isExplanation 
                            ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-800 dark:text-indigo-200 border border-indigo-100 dark:border-indigo-800 rounded-tl-sm'
                            : 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-100 dark:border-slate-600 rounded-tl-sm'
                      }`}
                    >
                      {/* Render text with bold support */}
                      <p dangerouslySetInnerHTML={{ 
                        __html: msg.text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') 
                      }} />
                    </div>
                  </div>
                </div>
              ))}
              
              {/* Typing Indicator if not finished */}
              {visibleMessages < conversation.length && (
                <div className="flex justify-start animate-pulse delay-75">
                  <div className="bg-slate-100 dark:bg-slate-700 px-4 py-3 rounded-2xl rounded-tl-sm flex gap-1.5 items-center">
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"></span>
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-100"></span>
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-200"></span>
                  </div>
                </div>
              )}
            </div>

            {/* Input Area (Fake) */}
            <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-700 flex items-center gap-3 opacity-50">
              <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                <Mic className="w-4 h-4 text-slate-400" />
              </div>
              <div className="flex-1 h-10 bg-slate-50 dark:bg-slate-900 rounded-full border border-slate-200 dark:border-slate-700"></div>
              <div className="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center">
                <ArrowRight className="w-5 h-5 text-white" />
              </div>
            </div>

          </div>
          
          {/* Floating Badge */}
          <div className="absolute -bottom-6 -left-6 md:-left-12 bg-white dark:bg-slate-800 p-4 rounded-2xl shadow-xl border border-slate-100 dark:border-slate-700 flex items-center gap-3 animate-bounce-slight z-20">
             <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                <ShieldCheck className="w-6 h-6" />
             </div>
             <div>
                <p className="font-black text-slate-900 dark:text-white">100%</p>
                <p className="text-xs font-bold text-slate-500 uppercase">Précision</p>
             </div>
          </div>

        </div>

      </div>
    </section>
  );
};

// --- 3. Immersive Animation Section ---
export const ImmersiveActionSection = () => {
  return (
    <section className="py-24 bg-white dark:bg-[#0F1422] relative overflow-hidden">
       <div className="max-w-7xl mx-auto px-6 grid lg:grid-cols-2 gap-12 items-center">
          
          <div className="relative">
              {/* Abstract Visual Representation of Learning Loop */}
              <div className="relative w-full aspect-square max-w-[500px] mx-auto">
                  {/* Central Core */}
                  <div className="absolute inset-0 flex items-center justify-center z-20">
                      <div className="w-32 h-32 bg-white dark:bg-slate-800 rounded-full shadow-2xl flex items-center justify-center border-4 border-indigo-50 dark:border-slate-700 z-20">
                          <img src="https://i.ibb.co/B2XmRwmJ/logo.png" className="w-20 h-20 object-contain" alt="Logo" />
                      </div>
                  </div>

                  {/* Orbiting Elements */}
                  <div className="absolute inset-0 animate-spin-slow">
                      <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 bg-indigo-100 dark:bg-indigo-900/50 rounded-2xl flex items-center justify-center text-indigo-600 shadow-lg transform -rotate-0">
                          <Mic className="w-8 h-8" />
                      </div>
                      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-16 h-16 bg-purple-100 dark:bg-purple-900/50 rounded-2xl flex items-center justify-center text-purple-600 shadow-lg transform -rotate-180">
                          <BarChart3 className="w-8 h-8" />
                      </div>
                      <div className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 bg-emerald-100 dark:bg-emerald-900/50 rounded-2xl flex items-center justify-center text-emerald-600 shadow-lg transform -rotate-90">
                          <Zap className="w-8 h-8" />
                      </div>
                      <div className="absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2 w-16 h-16 bg-amber-100 dark:bg-amber-900/50 rounded-2xl flex items-center justify-center text-amber-600 shadow-lg transform rotate-90">
                          <Brain className="w-8 h-8" />
                      </div>
                  </div>

                  {/* Connecting Rings */}
                  <div className="absolute inset-8 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-full animate-spin-reverse-slow opacity-50"></div>
                  <div className="absolute inset-24 border border-slate-100 dark:border-slate-800 rounded-full"></div>
              </div>
          </div>

          <div>
              <h2 className="text-3xl md:text-4xl font-black text-slate-900 dark:text-white mb-8">
                  La Méthode <span className="text-indigo-600">TeacherMada</span>
              </h2>
              
              <div className="space-y-8">
                  <div className="flex gap-4 group">
                      <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center text-indigo-600 font-bold text-xl group-hover:bg-indigo-600 group-hover:text-white transition-colors">1</div>
                      <div>
                          <h3 className="font-bold text-lg text-slate-900 dark:text-white mb-2">Immersion Totale</h3>
                          <p className="text-slate-600 dark:text-slate-400">Vous parlez dès la première seconde. Pas de théorie ennuyeuse, que de la pratique.</p>
                      </div>
                  </div>
                  <div className="flex gap-4 group">
                      <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-purple-50 dark:bg-purple-900/20 flex items-center justify-center text-purple-600 font-bold text-xl group-hover:bg-purple-600 group-hover:text-white transition-colors">2</div>
                      <div>
                          <h3 className="font-bold text-lg text-slate-900 dark:text-white mb-2">Analyse Intelligente Temps Réel</h3>
                          <p className="text-slate-600 dark:text-slate-400">Notre moteur analyse votre prononciation, grammaire et vocabulaire instantanément.</p>
                      </div>
                  </div>
                  <div className="flex gap-4 group">
                      <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center text-emerald-600 font-bold text-xl group-hover:bg-emerald-600 group-hover:text-white transition-colors">3</div>
                      <div>
                          <h3 className="font-bold text-lg text-slate-900 dark:text-white mb-2">Progression Continue</h3>
                          <p className="text-slate-600 dark:text-slate-400">Le cours s'adapte à vos lacunes. Chaque minute passée est optimisée pour vous faire avancer.</p>
                      </div>
                  </div>
              </div>
          </div>

       </div>
       <style>{`
        @keyframes spin-slow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes spin-reverse-slow {
          from { transform: rotate(360deg); }
          to { transform: rotate(0deg); }
        }
        .animate-spin-slow {
          animation: spin-slow 20s linear infinite;
        }
        .animate-spin-reverse-slow {
          animation: spin-reverse-slow 25s linear infinite;
        }
      `}</style>
    </section>
  );
};

// --- 4. Exam & Certificate Section ---
export const CertificateSection = ({ onStart }: { onStart: () => void }) => {
  return (
    <section className="py-20 md:py-32 bg-[#0B0F19] relative overflow-hidden">
       {/* Background Glow - Magical Atmosphere */}
       <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[300px] md:w-[800px] h-[500px] bg-indigo-900/20 rounded-full blur-[80px] md:blur-[120px] pointer-events-none"></div>
       <div className="absolute bottom-0 right-0 w-[300px] md:w-[600px] h-[600px] bg-amber-500/5 rounded-full blur-[80px] md:blur-[120px] pointer-events-none"></div>
       
       {/* Floating Particles (Simulated with CSS) */}
       <div className="absolute inset-0 opacity-20 pointer-events-none bg-[url('https://grainy-gradients.vercel.app/noise.svg')] mix-blend-overlay"></div>

       <div className="max-w-7xl mx-auto px-6 relative z-10">
          
          <div className="text-center mb-12 md:mb-20">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] md:text-xs font-bold uppercase tracking-widest mb-6 shadow-[0_0_15px_rgba(245,158,11,0.2)]">
              <Award className="w-3 h-3 md:w-4 md:h-4" /> Certification Officielle
            </div>
            
            <h2 className="text-4xl md:text-6xl font-black text-white mb-6 tracking-tight leading-tight">
               Prouvez votre <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-200 via-amber-400 to-amber-200 animate-gradient bg-300%">Excellence</span>.
            </h2>
            <p className="text-base md:text-xl text-slate-400 max-w-2xl mx-auto leading-relaxed">
               Ne dites plus juste que vous parlez une langue. <strong className="text-white">Prouvez-le.</strong><br className="hidden md:block"/>
               Nos certificats sont vérifiables, sécurisés et prêts à être partagés sur LinkedIn.
            </p>
          </div>

          <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
             
             {/* Left: Certificate Preview - Magical & 3D */}
             <div className="relative perspective-1000 group order-2 lg:order-1 w-full">
                {/* Magical Glow behind card */}
                <div className="absolute inset-0 bg-gradient-to-tr from-amber-500/30 via-purple-500/20 to-indigo-500/30 blur-3xl transform scale-90 group-hover:scale-105 transition-transform duration-1000"></div>
                
                {/* The Certificate Card - Responsive Container */}
                <div className="relative w-full aspect-[1.414/1] bg-[#FDFBF7] text-slate-900 rounded-xl md:rounded-2xl shadow-2xl overflow-hidden transform transition-all duration-700 hover:rotate-0 lg:rotate-y-6 lg:rotate-x-6 border border-white/10 ring-1 ring-black/5">
                   
                   {/* Guilloche Pattern Background */}
                   <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: 'radial-gradient(circle at center, #000 1px, transparent 1px)', backgroundSize: '24px 24px' }}></div>
                   <div className="absolute inset-0 bg-gradient-to-br from-white/80 via-transparent to-amber-50/50"></div>
                   
                   {/* Gold Foil Border Effect */}
                   <div className="absolute inset-2 md:inset-5 border-2 border-double border-amber-600/20 rounded-lg"></div>
                   <div className="absolute inset-3 md:inset-6 border border-slate-900/5 rounded-lg"></div>

                   {/* Content - Scaled for Mobile */}
                   <div className="absolute inset-0 p-4 md:p-10 flex flex-col justify-between">
                      {/* Header */}
                      <div className="flex justify-between items-start">
                          <div className="flex items-center gap-2 md:gap-3">
                              <img src="https://i.ibb.co/B2XmRwmJ/logo.png" className="w-6 h-6 md:w-12 md:h-12 object-contain grayscale opacity-80 mix-blend-multiply" alt="Logo" />
                              <span className="font-serif font-bold text-xs md:text-xl tracking-[0.2em] text-slate-900 uppercase">TeacherMada</span>
                          </div>
                          
                          {/* Stylish Ribbon */}
                          <div className="absolute top-0 right-6 md:right-10">
                             <div className="w-8 md:w-12 h-16 md:h-24 bg-gradient-to-b from-amber-500 to-amber-600 shadow-lg flex flex-col items-center pt-4 relative" style={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%, 50% 80%, 0 100%)' }}>
                                <div className="w-6 h-6 md:w-9 md:h-9 rounded-full border-2 border-white/30 flex items-center justify-center mb-1">
                                    <Award className="w-3 h-3 md:w-5 md:h-5 text-white drop-shadow-sm" />
                                </div>
                                <div className="w-px h-full bg-white/20"></div>
                             </div>
                          </div>
                      </div>

                      {/* Body */}
                      <div className="text-center space-y-2 md:space-y-6 my-auto relative z-10">
                          <h3 className="text-xl md:text-5xl font-serif font-black text-slate-900 uppercase tracking-[0.15em]">Certificat</h3>
                          <p className="font-serif italic text-slate-500 text-[10px] md:text-xl">Ce document atteste que</p>
                          
                          <div className="relative inline-block">
                             <p className="font-serif font-bold text-lg md:text-4xl text-indigo-950 border-b border-slate-200 pb-1 md:pb-2 px-4 md:px-12 relative z-10">Votre Nom</p>
                             <div className="absolute -bottom-1 left-0 w-full h-px bg-amber-500/50"></div>
                          </div>

                          <p className="font-serif italic text-slate-500 text-[10px] md:text-xl">a validé avec succès le niveau</p>
                          <div className="inline-block px-3 md:px-8 py-1 md:py-3 bg-slate-900 text-white font-bold text-sm md:text-2xl tracking-[0.2em] uppercase shadow-lg shadow-slate-900/20">
                              Anglais B2
                          </div>
                      </div>

                      {/* Footer */}
                      <div className="flex justify-between items-end mt-2 md:mt-4">
                          <div className="text-center">
                              <div className="h-6 md:h-12 flex items-end justify-center mb-1">
                                <span className="font-[cursive] text-slate-800 text-sm md:text-2xl transform -rotate-3 opacity-80" style={{ fontFamily: '"Dancing Script", cursive' }}>Rabemananjara</span>
                              </div>
                              <div className="w-12 md:w-32 h-px bg-slate-300 mb-1 mx-auto"></div>
                              <p className="text-[6px] md:text-[10px] uppercase font-bold text-slate-400 tracking-wider">Directeur Pédagogique</p>
                          </div>
                          
                          <div className="relative group/seal cursor-pointer">
                              <div className="w-8 h-8 md:w-20 md:h-20 border-2 border-amber-500 rounded-full flex items-center justify-center bg-gradient-to-br from-amber-50 to-white shadow-inner">
                                  <Award className="w-4 h-4 md:w-10 md:h-10 text-amber-500 drop-shadow-sm" />
                              </div>
                              <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-amber-500 text-white text-[6px] md:text-[10px] font-bold px-1.5 md:px-3 py-0.5 rounded-full uppercase tracking-wider shadow-md whitespace-nowrap group-hover/seal:scale-110 transition-transform">
                                  Vérifié
                              </div>
                          </div>
                      </div>
                   </div>
                   
                   {/* Shimmer Effect Overlay */}
                   <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 pointer-events-none z-20"></div>
                </div>
             </div>

             {/* Right: Actions & Benefits */}
             <div className="space-y-8 md:space-y-10 order-1 lg:order-2">
                <div className="space-y-4 md:space-y-6">
                    <BenefitItem 
                        icon={<Linkedin className="w-5 h-5 text-[#0077b5]" />}
                        title="Boostez votre profil LinkedIn"
                        desc="Ajoutez votre certificat en un clic à votre profil. Soyez visible par les recruteurs."
                    />
                    <BenefitItem 
                        icon={<ShieldCheck className="w-5 h-5 text-emerald-500" />}
                        title="100% Vérifiable"
                        desc="Chaque certificat possède un ID unique. Les employeurs peuvent vérifier son authenticité instantanément."
                    />
                    <BenefitItem 
                        icon={<Share2 className="w-5 h-5 text-indigo-500" />}
                        title="Partageable partout"
                        desc="Téléchargez votre diplôme en PDF haute définition ou partagez le lien direct."
                    />
                </div>

                <div className="pt-4">
                    <button 
                        onClick={onStart} 
                        className="w-full sm:w-auto px-8 py-5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-900 font-black text-lg rounded-2xl shadow-xl shadow-amber-500/20 hover:shadow-amber-500/40 transition-all transform hover:-translate-y-1 flex items-center justify-center gap-3 group"
                    >
                        <ShieldCheck className="w-6 h-6" />
                        Obtenir ma certification
                        <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                    </button>
                    <p className="text-slate-500 text-xs mt-4 text-center sm:text-left">
                        * Inclus dans l'abonnement Premium. Aucun frais caché.
                    </p>
                </div>
             </div>

          </div>
       </div>
    </section>
  );
};

const BenefitItem = ({ icon, title, desc }: { icon: React.ReactNode, title: string, desc: string }) => (
    <div className="flex gap-4 p-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
        <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-slate-900 flex items-center justify-center shadow-inner border border-white/5">
            {icon}
        </div>
        <div>
            <h4 className="text-white font-bold text-lg mb-1">{title}</h4>
            <p className="text-slate-400 text-sm leading-relaxed">{desc}</p>
        </div>
    </div>
);
