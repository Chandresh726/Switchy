"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

/**
 * Markdown renderer using react-markdown
 * Supports: headers, bold, italic, lists, links, code blocks, tables, and more
 */
export function MarkdownRenderer({ content, className = "" }: MarkdownRendererProps) {
  if (!content) return null;

  return (
    <div className={`max-w-none ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="text-xl font-semibold text-white mt-4 mb-2">{children}</h1>,
          h2: ({ children }) => <h2 className="text-lg font-semibold text-white mt-3 mb-2">{children}</h2>,
          h3: ({ children }) => <h3 className="text-base font-semibold text-white mt-3 mb-1">{children}</h3>,
          h4: ({ children }) => <h4 className="text-sm font-semibold text-white mt-2 mb-1">{children}</h4>,
          p: ({ children }) => <p className="my-2 text-zinc-300 leading-relaxed">{children}</p>,
          ul: ({ children }) => <ul className="list-disc pl-4 my-2 space-y-1 text-zinc-300">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-4 my-2 space-y-1 text-zinc-300">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-zinc-200">{children}</strong>,
          em: ({ children }) => <em className="italic text-zinc-300">{children}</em>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
              {children}
            </a>
          ),
          code: ({ children, className }) => {
            const isInline = !className;
            return isInline ? (
              <code className="bg-zinc-800 px-1 py-0.5 rounded text-xs text-zinc-300 font-mono">
                {children}
              </code>
            ) : (
              <pre className="bg-zinc-900 p-3 rounded my-2 overflow-x-auto">
                <code className="text-xs text-zinc-300 font-mono">{children}</code>
              </pre>
            );
          },
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-zinc-600 pl-3 italic my-2 text-zinc-400">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="border-zinc-700 my-4" />,
          table: ({ children }) => (
            <table className="w-full border-collapse my-2 text-xs">{children}</table>
          ),
          thead: ({ children }) => <thead className="bg-zinc-800">{children}</thead>,
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => <tr className="border-b border-zinc-700">{children}</tr>,
          th: ({ children }) => (
            <th className="text-left p-2 text-zinc-300 font-semibold">{children}</th>
          ),
          td: ({ children }) => <td className="p-2 text-zinc-400">{children}</td>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
