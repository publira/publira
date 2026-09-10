import { cn } from "@publira/utils";
import type { ReactNode } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";

interface MarkdownContentProps {
  content: string;
  emptyFallback?: ReactNode;
}

/**
 * A heading inside reading text is a section break, and a printed book gives
 * every one of them the same size: the level says where the reader is in the
 * structure, and the type says only that a new section starts here. So all six
 * take one step, set in the reading face and led tight against the body around
 * them.
 */
const HEADING_CLASS_NAME = cn("font-serif text-xl leading-tight");

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
  // An indented paragraph behind a hairline. Italic would be a second signal
  // saying the same thing, and in a CJK face it is a slant applied to letter-
  // forms that were never drawn with one.
  blockquote: ({ children }) => (
    <blockquote className="border-l border-border pl-4">{children}</blockquote>
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
  h1: ({ children }) => <h1 className={HEADING_CLASS_NAME}>{children}</h1>,
  h2: ({ children }) => <h2 className={HEADING_CLASS_NAME}>{children}</h2>,
  h3: ({ children }) => <h3 className={HEADING_CLASS_NAME}>{children}</h3>,
  h4: ({ children }) => <h4 className={HEADING_CLASS_NAME}>{children}</h4>,
  h5: ({ children }) => <h5 className={HEADING_CLASS_NAME}>{children}</h5>,
  h6: ({ children }) => <h6 className={HEADING_CLASS_NAME}>{children}</h6>,
  li: ({ children }) => <li>{children}</li>,
  ol: ({ children }) => (
    <ol className="list-decimal space-y-1 pl-6">{children}</ol>
  ),
  p: ({ children }) => <p>{children}</p>,
  // Code keeps the monospace face, the wash behind it, and its own line
  // height: it is the one passage on the page that is read as characters
  // rather than as prose.
  pre: ({ children }) => (
    <div className="rounded-control border border-border bg-muted/30">
      <pre className="overflow-x-auto p-4 font-mono text-xs leading-6">
        {children}
      </pre>
    </div>
  ),
  strong: ({ children }) => <strong>{children}</strong>,
  ul: ({ children }) => (
    <ul className="list-disc space-y-1 pl-6">{children}</ul>
  ),
};

/**
 * Rich text meant to be read from beginning to end: an episode body, a page a
 * tenant writes.
 *
 * It is set the way the design sets reading text — the serif face, the forty-
 * character measure, and the reading line height — and one step larger once
 * there is room for it, because a phone at `base` and a desktop at `lg` put
 * about the same number of characters on a line.
 *
 * The blocks are separated by `1lh`, which is one line of the body text around
 * them. A paragraph break in a book is a blank line rather than a measurement
 * of its own, and writing it as one keeps it a blank line at both sizes.
 */
export const MarkdownContent = ({
  content,
  emptyFallback = null,
}: MarkdownContentProps) => {
  if (!content.trim()) {
    return emptyFallback;
  }

  return (
    <div className="grid max-w-(--measure-prose) gap-[1lh] font-serif text-base leading-(--leading-reading-cjk) text-foreground sm:text-lg">
      <ReactMarkdown components={markdownComponents}>{content}</ReactMarkdown>
    </div>
  );
};
