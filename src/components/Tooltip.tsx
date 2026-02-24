
import React, { useState, useEffect } from 'react';

interface TooltipProps {
  children: React.ReactNode;
  text: string;
  position?: 'top' | 'bottom';
  className?: string;
}

const Tooltip: React.FC<TooltipProps> = ({ children, text, position = 'top', className = '' }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isTouch, setIsTouch] = useState(false);

  // Auto-hide after delay on touch/click
  useEffect(() => {
      let timer: any;
      if (isVisible && isTouch) {
          timer = setTimeout(() => {
              setIsVisible(false);
          }, 3000); // Increased slightly for mobile reading time
      }
      return () => clearTimeout(timer);
  }, [isVisible, isTouch]);

  const handleMouseEnter = () => {
      // If we are in touch mode (user tapped recently), ignore mouse enter to prevent double firing or sticky states
      if (!isTouch) setIsVisible(true);
  };

  const handleMouseLeave = () => {
      if (!isTouch) setIsVisible(false);
  };

  const handleInteraction = (e: React.MouseEvent | React.TouchEvent) => {
      // This handler is for explicit clicks or taps.
      // We set isTouch true to disable hover logic temporarily for mixed devices.
      e.stopPropagation(); // Prevents clicking the tooltip from doing weird things up the DOM
      setIsTouch(true);
      setIsVisible(prev => !prev); // Toggle visibility on click/tap
  };

  return (
    <div 
        className={`relative inline-flex items-center justify-center ${className}`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleInteraction}
        onTouchStart={() => setIsTouch(true)} // Hint that we are touching
    >
      {children}
      
      {isVisible && (
          <div 
            className={`
              absolute z-[150] px-3 py-2 
              bg-slate-800 text-white text-xs font-medium rounded-lg shadow-xl
              whitespace-nowrap animate-fade-in
              ${position === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'}
              left-1/2 -translate-x-1/2 pointer-events-none
            `}
            onClick={(e) => e.stopPropagation()}
          >
            {text}
            {/* Tiny Arrow */}
            <div 
              className={`
                absolute left-1/2 -translate-x-1/2 border-4 border-transparent
                ${position === 'top' ? 'border-t-slate-800 top-full' : 'border-b-slate-800 bottom-full'}
              `} 
            />
          </div>
      )}
    </div>
  );
};

export default Tooltip;
