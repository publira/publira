import { cn } from "@publira/utils";
import type { CSSProperties, ReactNode } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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

const hasClassName = (className: string | undefined, token: string): boolean =>
  className?.split(/\s+/u).includes(token) ?? false;

// A task list's marker is the checkbox, so the bullet or the number is dropped.
const listClassName = (
  className: string | undefined,
  markerClassName: string
): string =>
  hasClassName(className, "contains-task-list")
    ? "list-none space-y-1 pl-6"
    : `${markerClassName} space-y-1 pl-6`;

// GFM sets a column's alignment as `text-align`. Left is already the table's.
const horizontalAlignClassName = (
  style: CSSProperties | undefined
): string | undefined => {
  if (style?.textAlign === "center") {
    return "text-center";
  }
  if (style?.textAlign === "right") {
    return "text-right";
  }
  return undefined;
};

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
  // Struck words recede. The line is the mark; the muted ink says they are
  // no longer the sentence.
  del: ({ children }) => (
    <del className="text-muted-foreground line-through">{children}</del>
  ),
  h1: ({ children }) => <h1 className={HEADING_CLASS_NAME}>{children}</h1>,
  h2: ({ children }) => <h2 className={HEADING_CLASS_NAME}>{children}</h2>,
  h3: ({ children }) => <h3 className={HEADING_CLASS_NAME}>{children}</h3>,
  h4: ({ children }) => <h4 className={HEADING_CLASS_NAME}>{children}</h4>,
  h5: ({ children }) => <h5 className={HEADING_CLASS_NAME}>{children}</h5>,
  h6: ({ children }) => <h6 className={HEADING_CLASS_NAME}>{children}</h6>,
  // Disabled, so a reader cannot toggle it. `readOnly` is what keeps a
  // controlled checkbox from warning.
  input: ({ checked, type }) =>
    type === "checkbox" ? (
      <input
        checked={checked === true}
        className="mt-1 size-4 shrink-0 rounded-control border-input accent-primary"
        disabled
        readOnly
        type="checkbox"
      />
    ) : (
      <input disabled type={type} />
    ),
  // The item's words are the checkbox's accessible name.
  li: ({ children, className }) =>
    hasClassName(className, "task-list-item") ? (
      <li>
        <label className="flex items-start gap-2">{children}</label>
      </li>
    ) : (
      <li>{children}</li>
    ),
  ol: ({ children, className }) => (
    <ol className={listClassName(className, "list-decimal")}>{children}</ol>
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
  // A table is wider than the measure as soon as it has two columns.
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">{children}</table>
    </div>
  ),
  tbody: ({ children }) => (
    <tbody className="[&_tr:last-child]:border-0">{children}</tbody>
  ),
  td: ({ children, style }) => (
    <td className={cn("px-3 py-2 align-top", horizontalAlignClassName(style))}>
      {children}
    </td>
  ),
  th: ({ children, style }) => (
    <th
      className={cn(
        "px-3 py-2 align-bottom font-medium",
        horizontalAlignClassName(style)
      )}
    >
      {children}
    </th>
  ),
  thead: ({ children }) => (
    <thead className="[&_tr]:border-b-2 [&_tr]:border-border">{children}</thead>
  ),
  tr: ({ children }) => <tr className="border-b border-border">{children}</tr>,
  ul: ({ children, className }) => (
    <ul className={listClassName(className, "list-disc")}>{children}</ul>
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
    <div className="grid max-w-measure-prose gap-[1lh] font-serif text-base leading-(--leading-reading-cjk) text-foreground sm:text-lg">
      <ReactMarkdown
        components={markdownComponents}
        remarkPlugins={[remarkGfm]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};
