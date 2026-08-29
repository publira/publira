"use client";

import { getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { ReactNode } from "react";

interface MarkdownPreviewProps {
  content: string;
}

type MarkdownBlock =
  | { key: string; type: "blockquote"; text: string }
  | { key: string; type: "code"; code: string; language: string }
  | { key: string; type: "heading"; level: number; text: string }
  | { key: string; type: "ordered-list"; items: string[] }
  | { key: string; type: "paragraph"; text: string }
  | { key: string; type: "unordered-list"; items: string[] };

const toItemEntries = (blockKey: string, items: string[]) => {
  const counts = new Map<string, number>();

  return items.map((item) => {
    const count = counts.get(item) ?? 0;
    counts.set(item, count + 1);
    return {
      item,
      key: `${blockKey}-${item}-${count}`,
    };
  });
};

const parseInline = (text: string): ReactNode[] => {
  const nodes: ReactNode[] = [];
  const tokenPattern =
    /(?:`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/u;
  let rest = text;
  let key = 0;

  while (rest.length > 0) {
    const match = rest.match(tokenPattern);
    if (!match || match.index === undefined) {
      nodes.push(rest);
      break;
    }

    const [token] = match;
    if (match.index > 0) {
      nodes.push(rest.slice(0, match.index));
    }

    if (token.startsWith("`")) {
      nodes.push(
        <code
          className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.95em]"
          key={key}
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{parseInline(token.slice(2, -2))}</strong>);
    } else if (token.startsWith("*")) {
      nodes.push(<em key={key}>{parseInline(token.slice(1, -1))}</em>);
    } else {
      // Numbered groups: Next apps target ES2017 (no named capture groups).
      // oxlint-disable-next-line prefer-named-capture-group
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/u);
      if (linkMatch) {
        nodes.push(
          <a
            className="text-primary underline underline-offset-4"
            href={linkMatch[2]}
            key={key}
            rel="noreferrer"
            target="_blank"
          >
            {linkMatch[1]}
          </a>
        );
      } else {
        nodes.push(token);
      }
    }

    rest = rest.slice(match.index + token.length);
    key += 1;
  }

  return nodes;
};

const parseFencedCode = (
  lines: string[],
  index: number
): { block: MarkdownBlock; nextIndex: number } | null => {
  const line = lines[index];
  // Numbered groups: Next apps target ES2017 (no named capture groups).
  // oxlint-disable-next-line prefer-named-capture-group
  const fenceMatch = line.match(/^```(.*)$/u);
  if (!fenceMatch) {
    return null;
  }

  const codeLines: string[] = [];
  let nextIndex = index + 1;
  while (nextIndex < lines.length && !lines[nextIndex].startsWith("```")) {
    codeLines.push(lines[nextIndex]);
    nextIndex += 1;
  }

  return {
    block: {
      code: codeLines.join("\n"),
      key: `code-${index}`,
      language: fenceMatch[1].trim(),
      type: "code",
    },
    nextIndex: nextIndex + 1,
  };
};

const parseHeading = (
  line: string,
  index: number
): { block: MarkdownBlock; nextIndex: number } | null => {
  // Numbered groups: Next apps target ES2017 (no named capture groups).
  // oxlint-disable-next-line prefer-named-capture-group
  const headingMatch = line.match(/^(#{1,6})\s+(.*)$/u);
  if (!headingMatch) {
    return null;
  }

  return {
    block: {
      key: `heading-${index}`,
      level: headingMatch[1].length,
      text: headingMatch[2],
      type: "heading",
    },
    nextIndex: index + 1,
  };
};

const parseBlockquote = (
  lines: string[],
  index: number
): { block: MarkdownBlock; nextIndex: number } | null => {
  if (!lines[index].startsWith(">")) {
    return null;
  }

  const quoteLines: string[] = [];
  let nextIndex = index;
  while (nextIndex < lines.length && lines[nextIndex].startsWith(">")) {
    quoteLines.push(lines[nextIndex].replace(/^>\s?/u, ""));
    nextIndex += 1;
  }

  return {
    block: {
      key: `blockquote-${index}`,
      text: quoteLines.join(" "),
      type: "blockquote",
    },
    nextIndex,
  };
};

const parseList = (
  lines: string[],
  index: number,
  kind: "ordered-list" | "unordered-list"
): { block: MarkdownBlock; nextIndex: number } | null => {
  const matcher = kind === "unordered-list" ? /^[-*]\s+/u : /^\d+\.\s+/u;
  const replacer = kind === "unordered-list" ? /^[-*]\s+/u : /^\d+\.\s+/u;
  if (!matcher.test(lines[index])) {
    return null;
  }

  const items: string[] = [];
  let nextIndex = index;
  while (nextIndex < lines.length && matcher.test(lines[nextIndex])) {
    items.push(lines[nextIndex].replace(replacer, ""));
    nextIndex += 1;
  }

  return {
    block: {
      items,
      key: `${kind}-${index}`,
      type: kind,
    },
    nextIndex,
  };
};

const isParagraphLine = (line: string): boolean =>
  !!line.trim() &&
  !line.startsWith(">") &&
  !line.startsWith("```") &&
  !/^[-*]\s+/u.test(line) &&
  !/^\d+\.\s+/u.test(line) &&
  // oxlint-disable-next-line prefer-named-capture-group
  !/^(#{1,6})\s+/u.test(line);

const parseParagraph = (
  lines: string[],
  index: number
): { block: MarkdownBlock; nextIndex: number } => {
  const paragraphLines: string[] = [];
  let nextIndex = index;
  while (nextIndex < lines.length && isParagraphLine(lines[nextIndex])) {
    paragraphLines.push(lines[nextIndex]);
    nextIndex += 1;
  }

  return {
    block: {
      key: `paragraph-${index}`,
      text: paragraphLines.join(" "),
      type: "paragraph",
    },
    nextIndex,
  };
};

const parseMarkdown = (content: string): MarkdownBlock[] => {
  const lines = content.replaceAll("\r\n", "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fenced = parseFencedCode(lines, index);
    if (fenced) {
      blocks.push(fenced.block);
      index = fenced.nextIndex;
      continue;
    }

    const heading = parseHeading(line, index);
    if (heading) {
      blocks.push(heading.block);
      index = heading.nextIndex;
      continue;
    }

    const quote = parseBlockquote(lines, index);
    if (quote) {
      blocks.push(quote.block);
      index = quote.nextIndex;
      continue;
    }

    const unordered = parseList(lines, index, "unordered-list");
    if (unordered) {
      blocks.push(unordered.block);
      index = unordered.nextIndex;
      continue;
    }

    const ordered = parseList(lines, index, "ordered-list");
    if (ordered) {
      blocks.push(ordered.block);
      index = ordered.nextIndex;
      continue;
    }

    const paragraph = parseParagraph(lines, index);
    blocks.push(paragraph.block);
    index = paragraph.nextIndex;
  }

  return blocks;
};

export const MarkdownPreview = ({ content }: MarkdownPreviewProps) => {
  const messages = sharedCatalog(document.documentElement.lang);
  const blocks = parseMarkdown(content);

  if (blocks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {getMessage(messages, "admin.pages.preview_empty")}
      </p>
    );
  }

  return (
    <div className="grid gap-4 text-sm leading-7 text-foreground">
      {blocks.map((block) => {
        if (block.type === "heading") {
          if (block.level === 1) {
            return (
              <h1
                className="text-3xl font-semibold tracking-tight"
                key={block.key}
              >
                {parseInline(block.text)}
              </h1>
            );
          }
          if (block.level === 2) {
            return (
              <h2
                className="text-2xl font-semibold tracking-tight"
                key={block.key}
              >
                {parseInline(block.text)}
              </h2>
            );
          }
          return (
            <h3
              className="text-xl font-semibold tracking-tight"
              key={block.key}
            >
              {parseInline(block.text)}
            </h3>
          );
        }

        if (block.type === "paragraph") {
          return <p key={block.key}>{parseInline(block.text)}</p>;
        }

        if (block.type === "blockquote") {
          return (
            <blockquote
              className="border-l-4 border-border pl-4 text-muted-foreground italic"
              key={block.key}
            >
              {parseInline(block.text)}
            </blockquote>
          );
        }

        if (block.type === "unordered-list") {
          const itemEntries = toItemEntries(block.key, block.items);
          return (
            <ul className="list-disc space-y-1 pl-6" key={block.key}>
              {itemEntries.map(({ item, key }) => (
                <li key={key}>{parseInline(item)}</li>
              ))}
            </ul>
          );
        }

        if (block.type === "ordered-list") {
          const itemEntries = toItemEntries(block.key, block.items);
          return (
            <ol className="list-decimal space-y-1 pl-6" key={block.key}>
              {itemEntries.map(({ item, key }) => (
                <li key={key}>{parseInline(item)}</li>
              ))}
            </ol>
          );
        }

        return (
          <div
            className="rounded-xl border border-border/70 bg-muted/30"
            key={block.key}
          >
            {block.language ? (
              <div className="border-b border-border/70 px-4 py-2 text-xs tracking-wide text-muted-foreground uppercase">
                {block.language}
              </div>
            ) : null}
            <pre className="overflow-x-auto p-4 text-xs leading-6">
              <code>{block.code}</code>
            </pre>
          </div>
        );
      })}
    </div>
  );
};
