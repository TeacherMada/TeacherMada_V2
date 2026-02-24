
import React, { useRef, useState, useEffect } from 'react';
import { ExamResultDetailed } from '../types';
import { Download, X, Home, FileText, ChevronDown, Image as ImageIcon, Loader2, Link, Check } from 'lucide-react';
import QRCode from 'react-qr-code';
import { toPng } from 'html-to-image';
import jsPDF from 'jspdf';

interface Props {
    result: ExamResultDetailed;
    onClose: () => void;
}

const CertificateView: React.FC<Props> = ({ result, onClose }) => {
    const certRef = useRef<HTMLDivElement>(null);
    const [isExporting, setIsExporting] = useState(false);
    const [showReport, setShowReport] = useState(false);
    const [copied, setCopied] = useState(false);
    const [scale, setScale] = useState(1);
    const containerRef = useRef<HTMLDivElement>(null);

    // Responsive scaling for preview
    useEffect(() => {
        const updateScale = () => {
            if (containerRef.current) {
                const containerWidth = containerRef.current.offsetWidth;
                const containerHeight = containerRef.current.offsetHeight;
                // A4 Landscape dimensions in pixels (approx 1123x794)
                const targetWidth = 1123;
                const targetHeight = 794;
                
                // Calculate scale to fit within container with some padding
                const scaleX = (containerWidth - 40) / targetWidth;
                const scaleY = (containerHeight - 120) / targetHeight; // Leave room for buttons
                
                setScale(Math.min(scaleX, scaleY, 1)); // Don't scale up beyond 1
            }
        };

        updateScale();
        window.addEventListener('resize', updateScale);
        return () => window.removeEventListener('resize', updateScale);
    }, []);

    const handleExportPNG = async () => {
        if (!certRef.current) return;
        setIsExporting(true);
        try {
            // Temporarily remove scale for high-quality capture
            const originalTransform = certRef.current.style.transform;
            certRef.current.style.transform = 'none';
            
            const dataUrl = await toPng(certRef.current, { 
                quality: 1,
                pixelRatio: 2, // High resolution
                cacheBust: true,
            });
            
            certRef.current.style.transform = originalTransform;

            const link = document.createElement('a');
            link.download = `Certificat_${result.userName.replace(/\s+/g, '_')}_${result.detectedLevel}.png`;
            link.href = dataUrl;
            link.click();
        } catch (err) {
            console.error('Failed to export PNG', err);
        } finally {
            setIsExporting(false);
        }
    };

    const handleExportPDF = async () => {
        if (!certRef.current) return;
        setIsExporting(true);
        try {
            const originalTransform = certRef.current.style.transform;
            certRef.current.style.transform = 'none';
            
            const dataUrl = await toPng(certRef.current, { 
                quality: 1,
                pixelRatio: 2,
                cacheBust: true,
            });
            
            certRef.current.style.transform = originalTransform;

            const pdf = new jsPDF({
                orientation: 'landscape',
                unit: 'mm',
                format: 'a4'
            });
            
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = pdf.internal.pageSize.getHeight();
            
            pdf.addImage(dataUrl, 'PNG', 0, 0, pdfWidth, pdfHeight);
            pdf.save(`Certificat_${result.userName.replace(/\s+/g, '_')}_${result.detectedLevel}.pdf`);
        } catch (err) {
            console.error('Failed to export PDF', err);
        } finally {
            setIsExporting(false);
        }
    };

    const handleCopyLink = () => {
        const url = `${window.location.origin}/verify/${result.certificateId}`;
        navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const formattedDate = new Date(result.date).toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });

    // Dynamic Language - Level (Strip emojis just in case)
    const cleanLanguage = (result.language || 'Langue Inconnue').replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '').trim();
    const languageDisplay = `${cleanLanguage} - ${result.detectedLevel || 'Niveau Inconnu'}`;

    return (
        <div className="fixed inset-0 z-[100] bg-slate-900/95 backdrop-blur-md flex flex-col items-center p-4 font-sans overflow-hidden">
            
            {/* Header Controls */}
            <div className="w-full max-w-[1123px] flex flex-col md:flex-row justify-between items-center mb-6 z-50 gap-4">
                <button onClick={onClose} className="w-full md:w-auto flex items-center justify-center gap-2 px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl backdrop-blur-sm transition-all font-bold text-sm border border-white/10 hover:border-white/30">
                    <Home className="w-4 h-4" /> <span className="md:inline">Accueil</span>
                </button>

                <div className="w-full md:w-auto flex flex-wrap justify-center gap-2 bg-slate-800/50 p-1.5 rounded-2xl border border-white/10 backdrop-blur-sm">
                    <button onClick={() => setShowReport(true)} className="flex-1 md:flex-none flex items-center justify-center gap-2 px-3 py-2 hover:bg-white/10 text-slate-300 hover:text-white rounded-xl transition-all font-bold text-xs md:text-sm whitespace-nowrap">
                        <FileText className="w-4 h-4" /> Rapport
                    </button>
                    <button onClick={handleCopyLink} className="flex-1 md:flex-none flex items-center justify-center gap-2 px-3 py-2 hover:bg-white/10 text-slate-300 hover:text-white rounded-xl transition-all font-bold text-xs md:text-sm whitespace-nowrap">
                        {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Link className="w-4 h-4" />} 
                        {copied ? 'Copié' : 'Lien'}
                    </button>
                    <button onClick={handleExportPNG} disabled={isExporting} className="flex-1 md:flex-none flex items-center justify-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl shadow-lg shadow-indigo-500/20 transition-all font-bold text-xs md:text-sm disabled:opacity-50 whitespace-nowrap">
                        {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />} PNG
                    </button>
                    <button onClick={handleExportPDF} disabled={isExporting} className="flex-1 md:flex-none flex items-center justify-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl shadow-lg shadow-emerald-500/20 transition-all font-bold text-xs md:text-sm disabled:opacity-50 whitespace-nowrap">
                        {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} PDF
                    </button>
                </div>
            </div>

            {/* Report Modal */}
            {showReport && (
                <div className="absolute inset-0 z-[60] bg-slate-900/95 backdrop-blur-xl flex items-center justify-center p-4 animate-fade-in overflow-y-auto">
                    <div className="bg-white dark:bg-slate-800 w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden flex flex-col my-auto">
                        <div className="p-6 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-900/50">
                            <h3 className="text-xl font-black text-slate-900 dark:text-white flex items-center gap-2">
                                <FileText className="w-5 h-5 text-indigo-500" /> Rapport Détaillé
                            </h3>
                            <button onClick={() => setShowReport(false)} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition-colors">
                                <X className="w-5 h-5 text-slate-500" />
                            </button>
                        </div>
                        <div className="p-8">
                            <div className="flex flex-col sm:flex-row items-center gap-6 mb-8">
                                <div className="flex items-center gap-4">
                                    <div className="w-20 h-20 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 font-black text-3xl">
                                        {Math.round(result.globalScore)}%
                                    </div>
                                    <div>
                                        <div className="text-sm font-bold text-slate-500 uppercase">Score Global</div>
                                        <div className="text-2xl font-black text-slate-900 dark:text-white">{result.passed ? 'Admis' : 'Non Admis'}</div>
                                    </div>
                                </div>
                                
                                <div className="h-px sm:h-12 w-full sm:w-px bg-slate-200 dark:bg-slate-700"></div>

                                <div className="grid grid-cols-2 gap-6 w-full sm:w-auto">
                                    <div>
                                        <div className="text-xs font-bold text-slate-500 uppercase mb-1">Niveau</div>
                                        <div className="text-xl font-black text-indigo-600 dark:text-indigo-400">{result.detectedLevel}</div>
                                    </div>
                                    {result.confidenceScore !== undefined && (
                                        <div>
                                            <div className="text-xs font-bold text-slate-500 uppercase mb-1">Confiance</div>
                                            <div className="text-xl font-black text-amber-500">{result.confidenceScore}%</div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <h4 className="font-bold text-slate-900 dark:text-white mb-4 text-sm uppercase flex items-center gap-2">
                                <span className="w-1 h-4 bg-indigo-500 rounded-full"></span>
                                Compétences
                            </h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
                                {Object.entries(result.skillScores).map(([skill, score]) => (
                                    <div key={skill} className="p-4 bg-slate-50 dark:bg-slate-700/30 rounded-xl border border-slate-100 dark:border-slate-700">
                                        <div className="flex justify-between items-end mb-2">
                                            <div className="text-xs font-bold text-slate-500 uppercase">{skill}</div>
                                            <div className="text-lg font-black text-slate-900 dark:text-white">{score}%</div>
                                        </div>
                                        <div className="h-2 bg-slate-200 dark:bg-slate-600 rounded-full overflow-hidden">
                                            <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${score}%` }}></div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="bg-indigo-50 dark:bg-indigo-900/10 p-6 rounded-2xl border border-indigo-100 dark:border-indigo-900/30">
                                <h4 className="font-bold text-indigo-900 dark:text-indigo-300 mb-2 text-sm uppercase">Feedback Pédagogique</h4>
                                <p className="text-slate-700 dark:text-slate-300 text-sm leading-relaxed whitespace-pre-line">
                                    {result.feedback}
                                </p>
                            </div>
                        </div>
                        <div className="p-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 text-center mt-auto">
                            <button onClick={() => setShowReport(false)} className="text-sm font-bold text-slate-500 hover:text-slate-800 dark:hover:text-white transition-colors">
                                Fermer le rapport
                            </button>
                        </div>
                    </div>
                </div>
            )}
            
            {/* Certificate Preview Wrapper */}
            <div 
                ref={containerRef}
                className="flex-1 w-full flex items-center justify-center relative overflow-hidden"
            >
                <div 
                    className="relative bg-white shadow-2xl transition-transform duration-200 origin-center"
                    style={{ 
                        width: '1123px', 
                        height: '794px',
                        transform: `scale(${scale})`,
                    }}
                >
                    {/* The Actual Certificate to be captured */}
                    <div 
                        ref={certRef}
                        className="absolute inset-0 w-[1123px] h-[794px] bg-white flex flex-col box-border relative"
                        style={{ fontFamily: "'Montserrat', 'Lato', 'Open Sans', sans-serif" }}
                    >
                        {/* Outer Border Frame */}
                        <div className="absolute inset-0 border-[12px] border-[#1b365d] z-0"></div>
                        
                        {/* Inner Border Frame */}
                        <div className="absolute inset-[20px] border-[2px] border-[#1b365d] z-0"></div>

                        {/* Watermark/Background Logo */}
                        <div className="absolute inset-0 flex items-center justify-center opacity-[0.08] z-0 pointer-events-none">
                            <img src="https://i.ibb.co/B2XmRwmJ/logo.png" className="w-[500px] h-[500px] object-contain grayscale" alt="" />
                        </div>

                        {/* Content Container */}
                        <div className="relative z-10 flex-1 flex flex-col justify-between p-[60px] h-full">
                            
                            {/* Header */}
                            <div className="text-center space-y-6 mt-4">
                                <h1 className="text-[64px] font-black text-[#1b365d] tracking-[0.15em] uppercase leading-tight" style={{ fontFamily: "'Montserrat', sans-serif" }}>
                                    TEACHERMADA
                                </h1>
                                <div className="space-y-4 flex flex-col items-center">
                                    <h2 className="text-[36px] font-bold text-[#9c7c38] tracking-[0.1em] uppercase" style={{ fontFamily: "'Montserrat', sans-serif" }}>
                                        CERTIFICAT DE RÉUSSITE
                                    </h2>
                                </div>
                            </div>

                            {/* Body */}
                            <div className="text-center space-y-8 flex-1 flex flex-col justify-center items-center min-h-0 -mt-4">
                                <p className="text-[24px] text-[#1b365d] tracking-wide font-medium">
                                    Nous avons l’honneur de certifier que
                                </p>
                                
                                <h3 className="text-[56px] font-black text-[#1b365d] uppercase tracking-wider leading-tight px-8" style={{ fontFamily: "'Montserrat', sans-serif" }}>
                                    {result.userFullName || result.userName || "ÉTUDIANT"}
                                </h3>
                                
                                <div className="space-y-4">
                                    <p className="text-[24px] text-[#1b365d] tracking-wide font-medium leading-relaxed">
                                        a complété avec excellence et distinction<br/>
                                        le programme professionnel de :
                                    </p>
                                    
                                    <h4 className="text-[42px] font-bold text-[#1b365d] uppercase tracking-widest mt-6" style={{ fontFamily: "'Montserrat', sans-serif" }}>
                                        {languageDisplay}
                                    </h4>
                                    <div className="w-[300px] h-[2px] bg-[#1b365d] mx-auto mt-6 opacity-30"></div>
                                </div>
                            </div>

                            {/* Footer */}
                            <div className="relative flex justify-between items-end px-4 pb-4">
                                
                                {/* Date & ID Left */}
                                <div className="text-center space-y-2 w-[280px] pb-2">
                                    <p className="text-[18px] text-[#1b365d] font-medium">Date :</p>
                                    <p className="text-[24px] text-[#1b365d] border-b-2 border-[#1b365d] pb-2 px-8 inline-block w-full font-bold">
                                        {formattedDate}
                                    </p>
                                    <p className="text-[14px] text-[#1b365d] pt-2 tracking-wider font-medium opacity-70">
                                        ID : {result.certificateId}
                                    </p>
                                </div>

                                {/* Gold Seal Center */}
                                <div className="absolute left-1/2 bottom-0 -translate-x-1/2 flex flex-col items-center justify-center">
                                    {/* Ribbons */}
                                    <div className="absolute -bottom-6 flex gap-16 z-0">
                                        <div className="w-12 h-24 bg-[#1b365d]" style={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%, 50% 80%, 0 100%)', transform: 'rotate(30deg) translateY(-10px)' }}></div>
                                        <div className="w-12 h-24 bg-[#1b365d]" style={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%, 50% 80%, 0 100%)', transform: 'rotate(-30deg) translateY(-10px)' }}></div>
                                    </div>
                                    {/* Gold Coin */}
                                    <div className="relative z-10 w-[160px] h-[160px] rounded-full bg-gradient-to-br from-[#fceabb] via-[#f8b500] to-[#b38728] border-[6px] border-[#fff] shadow-xl flex items-center justify-center">
                                        <div className="w-[130px] h-[130px] rounded-full border-[2px] border-[#d4af37]/60 flex items-center justify-center bg-gradient-to-br from-[#f8b500] to-[#d4af37]">
                                            <svg viewBox="0 0 24 24" className="w-[80px] h-[80px] text-[#fff6d9] drop-shadow-md fill-current">
                                                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                                            </svg>
                                        </div>
                                    </div>
                                </div>

                                {/* Signature & QR Right */}
                                <div className="flex items-end justify-end gap-6 w-[340px] pb-2">
                                    <div className="text-center flex-1 mb-1">
                                        <div className="font-serif italic text-[48px] text-[#0f52ba] transform -rotate-6 opacity-90 leading-none" style={{ fontFamily: "'Brush Script MT', 'Caveat', cursive" }}>
                                            Rabemananjara
                                        </div>
                                        <div className="w-full h-[2px] bg-[#1b365d] mt-2"></div>
                                        <p className="text-[14px] text-[#1b365d] pt-2 font-bold tracking-widest">RABEMANANJARA</p>
                                    </div>
                                    <div className="p-2 border-[2px] border-[#1b365d] bg-white shrink-0">
                                        <QRCode 
                                            value={`${window.location.origin}/verify/${result.certificateId}`} 
                                            size={90} 
                                            level="M"
                                            fgColor="#1b365d"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CertificateView;
