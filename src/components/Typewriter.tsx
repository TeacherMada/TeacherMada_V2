
import React, { useState, useEffect } from 'react';
import MarkdownRenderer from './MarkdownRenderer';

interface TypewriterProps {
  text: string;
  speed?: number;
  onComplete?: () => void;
}

const Typewriter: React.FC<TypewriterProps> = ({ text, speed = 10, onComplete }) => {
  const [displayedText, setDisplayedText] = useState('');

  useEffect(() => {
    let index = 0;
    // If text is very long, render it in chunks to avoid extremely slow typing
    const chunkSize = 5; 
    
    // Reset displayed text at the start of the interval to avoid synchronous setState in effect
    let hasReset = false;

    const intervalId = setInterval(() => {
      if (!hasReset) {
          setDisplayedText('');
          hasReset = true;
          return;
      }

      if (index < text.length) {
        setDisplayedText((prev) => prev + text.slice(index, index + chunkSize));
        index += chunkSize;
      } else {
        clearInterval(intervalId);
        if (onComplete) onComplete();
      }
    }, speed);

    return () => clearInterval(intervalId);
  }, [text, speed, onComplete]);

  return <MarkdownRenderer content={displayedText} />; 
};

export default Typewriter;
