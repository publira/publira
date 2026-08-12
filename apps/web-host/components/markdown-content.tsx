import type { ReactNode } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";

interface MarkdownContentProps {
  content: string;
  className?: string;
  emptyFallback?: ReactNode;
}

const markdownComponents: Components = {
  a: ({ href, children }) => (
    <a
      className="text-primary underline underline-offset-4"
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-border pl-4 text-muted-foreground italic">
      {children}
    </blockquote>
  ),
  code: ({ className, children }) => {
    const isBlock = Boolean(className);
    if (isBlock) {
      return <code className={className}>{children}</code>;
    }
    return (
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.95em]">
        {children}
      </code>
    );
  },
  h1: ({ children }) => (
    <h1 className="text-3xl font-semibold tracking-tight">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-2xl font-semibold tracking-tight">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-xl font-semibold tracking-tight">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-lg font-semibold tracking-tight">{children}</h4>
  ),
  h5: ({ children }) => (
    <h5 className="text-base font-semibold tracking-tight">{children}</h5>
  ),
  h6: ({ children }) => (
    <h6 className="text-sm font-semibold tracking-tight">{children}</h6>
  ),
  li: ({ children }) => <li>{children}</li>,
  ol: ({ children }) => (
    <ol className="list-decimal space-y-1 pl-6">{children}</ol>
  ),
  p: ({ children }) => <p>{children}</p>,
  pre: ({ children }) => (
    <div className="rounded-xl border border-border/70 bg-muted/30">
      <pre className="overflow-x-auto p-4 text-xs leading-6">{children}</pre>
    </div>
  ),
  strong: ({ children }) => <strong>{children}</strong>,
  ul: ({ children }) => (
    <ul className="list-disc space-y-1 pl-6">{children}</ul>
  ),
};

export const MarkdownContent = ({
  content,
  className,
  emptyFallback = null,
}: MarkdownContentProps) => {
  if (!content.trim()) {
    return emptyFallback;
  }

  return (
    <div
      className={className ?? "grid gap-4 text-base leading-7 text-foreground"}
    >
      <ReactMarkdown components={markdownComponents}>{content}</ReactMarkdown>
    </div>
  );
};
