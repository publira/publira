"use client";

import type { ReactNode } from "react";

interface MarkdownPreviewProps {
  content: string;
}

type MarkdownBlock =
  | { type: "blockquote"; text: string }
  | { type: "code"; code: string; language: string }
  | { type: "heading"; level: number; text: string }
  | { type: "ordered-list"; items: string[] }
  | { type: "paragraph"; text: string }
  | { type: "unordered-list"; items: string[] };

const parseInline = (text: string): ReactNode[] => {
  const nodes: ReactNode[] = [];
  const tokenPattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/;
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
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
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

    const fenceMatch = line.match(/^```(.*)$/);
    if (fenceMatch) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push({
        code: codeLines.join("\n"),
        language: fenceMatch[1].trim(),
        type: "code",
      });
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      blocks.push({
        level: headingMatch[1].length,
        text: headingMatch[2],
        type: "heading",
      });
      index += 1;
      continue;
    }

    if (line.startsWith(">")) {
      const quoteLines: string[] = [];
      while (index < lines.length && lines[index].startsWith(">")) {
        quoteLines.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({
        text: quoteLines.join(" "),
        type: "blockquote",
      });
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^[-*]\s+/, ""));
        index += 1;
      }
      blocks.push({ items, type: "unordered-list" });
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push({ items, type: "ordered-list" });
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !lines[index].startsWith(">") &&
      !lines[index].startsWith("```") &&
      !/^[-*]\s+/.test(lines[index]) &&
      !/^\d+\.\s+/.test(lines[index]) &&
      !/^(#{1,6})\s+/.test(lines[index])
    ) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    blocks.push({
      text: paragraphLines.join(" "),
      type: "paragraph",
    });
  }

  return blocks;
};

export const MarkdownPreview = ({ content }: MarkdownPreviewProps) => {
  const blocks = parseMarkdown(content);

  if (blocks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        まだ内容がありません。左側のエディタに Markdown を入力するとプレビューが表示されます。
      </p>
    );
  }

  return (
    <div className="grid gap-4 text-sm leading-7 text-foreground">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          if (block.level === 1) {
            return (
              <h1 className="text-3xl font-semibold tracking-tight" key={index}>
                {parseInline(block.text)}
              </h1>
            );
          }
          if (block.level === 2) {
            return (
              <h2 className="text-2xl font-semibold tracking-tight" key={index}>
                {parseInline(block.text)}
              </h2>
            );
          }
          return (
            <h3 className="text-xl font-semibold tracking-tight" key={index}>
              {parseInline(block.text)}
            </h3>
          );
        }

        if (block.type === "paragraph") {
          return <p key={index}>{parseInline(block.text)}</p>;
        }

        if (block.type === "blockquote") {
          return (
            <blockquote
              className="border-l-4 border-border pl-4 italic text-muted-foreground"
              key={index}
            >
              {parseInline(block.text)}
            </blockquote>
          );
        }

        if (block.type === "unordered-list") {
          return (
            <ul className="list-disc space-y-1 pl-6" key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{parseInline(item)}</li>
              ))}
            </ul>
          );
        }

        if (block.type === "ordered-list") {
          return (
            <ol className="list-decimal space-y-1 pl-6" key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{parseInline(item)}</li>
              ))}
            </ol>
          );
        }

        return (
          <div className="rounded-xl border border-border/70 bg-muted/30" key={index}>
            {block.language ? (
              <div className="border-b border-border/70 px-4 py-2 text-xs uppercase tracking-wide text-muted-foreground">
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