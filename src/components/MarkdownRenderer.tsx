import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Volume2 } from 'lucide-react';

interface MarkdownRendererProps {
  content: string;
  onPlayAudio?: (text: string) => void;
  highlight?: string;
}

// Helper component to highlight text
const Highlight: React.FC<{ text: string; query?: string }> = ({ text, query }) => {
  if (!query || !text) return <>{text}</>;
  
  const parts = text.split(new RegExp(`(${query})`, 'gi'));
  return (
    <>
      {parts.map((part, i) => 
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="bg-yellow-300 text-slate-900 rounded-sm px-0.5 font-medium mx-0.5">
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  );
};

// Helper to recursively highlight children
const highlightChildren = (children: React.ReactNode, query?: string): React.ReactNode => {
    if (!query) return children;

    return React.Children.map(children, (child) => {
        if (typeof child === 'string') {
            return <Highlight text={child} query={query} />;
        }
        if (React.isValidElement(child)) {
             // @ts-ignore - cloning element to process its children
            return React.cloneElement(child, {
                // @ts-ignore
                children: highlightChildren(child.props.children, query)
            });
        }
        return child;
    });
};

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, onPlayAudio, highlight }) => {
  
  const processNode = (props: any, Tag: any) => {
      // react-markdown passes 'node' (AST) in props, which shouldn't be passed to DOM
      const { node, children, ...rest } = props;
      return <Tag {...rest}>{highlightChildren(children, highlight)}</Tag>;
  };

  return (
    <div className="prose prose-indigo dark:prose-invert max-w-none prose-p:leading-relaxed prose-li:marker:text-indigo-500 dark:prose-li:marker:text-indigo-400">
      <ReactMarkdown 
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (props) => processNode(props, ({children, ...rest}: any) => 
            <h1 className="text-xl font-black text-rose-600 dark:text-rose-500 uppercase tracking-tight mb-6 pb-4 border-b-2 border-rose-100 dark:border-rose-900/30 leading-tight" {...rest}>
                {children}
            </h1>
          ),
          h2: (props) => processNode(props, ({children, ...rest}: any) => 
            <h2 className="text-xl font-bold text-slate-800 dark:text-white mt-6 mb-3 flex items-center gap-2" {...rest}>
                {children}
            </h2>
          ),
          h3: (props) => processNode(props, ({children, ...rest}: any) => 
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mt-6 mb-2 ml-1" {...rest}>
                {children}
            </h3>
          ),
          ul: (props) => processNode(props, ({children, ...rest}: any) => <ul className="list-disc list-outside ml-4 space-y-1 mb-3 text-slate-700 dark:text-slate-300 marker:text-indigo-500" {...rest}>{children}</ul>),
          ol: (props) => processNode(props, ({children, ...rest}: any) => <ol className="list-decimal list-outside ml-4 space-y-1 mb-3 text-slate-700 dark:text-slate-300 marker:font-bold marker:text-slate-500" {...rest}>{children}</ol>),
          li: (props) => processNode(props, ({children, ...rest}: any) => <li className="pl-1" {...rest}>{children}</li>),
          blockquote: (props) => processNode(props, ({children, ...rest}: any) => <blockquote className="border-l-4 border-indigo-400 dark:border-indigo-600 pl-3 py-1 italic bg-indigo-50 dark:bg-indigo-900/20 rounded-r-lg my-2 text-slate-700 dark:text-indigo-100 text-sm" {...rest}>{children}</blockquote>),
          code: ({node, className, children, ...props}) => {
             const match = /language-(\w+)/.exec(className || '')
             return !String(children).includes('\n') ? (
              <code className="bg-slate-100 dark:bg-slate-700/50 text-slate-800 dark:text-indigo-200 px-1.5 py-0.5 rounded text-xs font-mono font-bold border border-slate-200 dark:border-slate-700" {...props}>
                {highlight ? <Highlight text={String(children)} query={highlight} /> : children}
              </code>
            ) : (
              <pre className="bg-[#1E1E1E] text-slate-200 p-3 rounded-xl overflow-x-auto my-3 text-xs border border-slate-700 shadow-inner">
                <code className={className} {...props}>
                  {children}
                </code>
              </pre>
            )
          },
          p: (props) => processNode(props, ({children, ...rest}: any) => <p className="mb-2 text-slate-700 dark:text-slate-300 last:mb-0 leading-relaxed" {...rest}>{children}</p>),
          strong: ({node, children, ...props}) => {
            const textContent = String(children);
            // On considère que c'est du vocabulaire cible si c'est court (moins de 100 chars)
            const showAudio = onPlayAudio && textContent.length < 100;
            
            const content = highlight ? <Highlight text={textContent} query={highlight} /> : children;

            if (!showAudio) {
               // Fallback pour le gras normal (ex: dans une longue phrase)
               return <strong className="font-bold text-slate-900 dark:text-white" {...props}>{content}</strong>;
            }

            // Style pour les mots cibles (Target Language) -> Gras + Couleur + Audio
            return (
                <span 
                    className="inline-flex items-center gap-1 align-baseline group/word cursor-pointer bg-indigo-50 dark:bg-indigo-500/10 px-1.5 py-0.5 rounded-md hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-all border border-indigo-200/50 dark:border-indigo-500/20 active:scale-95"
                    onClick={(e) => {
                        e.stopPropagation();
                        onPlayAudio(textContent);
                    }}
                    title="Écouter la prononciation"
                    role="button"
                >
                    <strong className="font-bold text-indigo-700 dark:text-indigo-300" {...props}>{content}</strong>
                    <Volume2 className="w-3 h-3 text-indigo-400 dark:text-indigo-400 opacity-100" />
                </span>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

export default React.memo(MarkdownRenderer);
