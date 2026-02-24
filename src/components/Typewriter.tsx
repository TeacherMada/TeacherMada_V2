
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
    
    const intervalId = setInterval(() => {
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

  // If the text updates entirely, reset (simple handling)
  useEffect(() => {
      setDisplayedText('');
  }, [text]);

  return <MarkdownRenderer content={displayedText || text} />; // Fallback to full text if logic fails or instant render needed
};

export default Typewriter;
