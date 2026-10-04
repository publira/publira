/**
 * Fail on a page under `docs/en/` that breaks the contract the website reads it by.
 *
 *     node scripts/check-docs.ts
 *
 * `docs/README.md` states that contract: the `<n>-<slug>` names the URLs are
 * derived from, an `index.md` in every directory, the frontmatter keys, and the
 * relative links the website rewrites to page URLs. Every one of those is
 * something the website only finds out about while it builds a release, in
 * another repository, long after the pull request that broke it was merged —
 * and a tag cannot be fixed afterwards. So the rules are checked here, where the
 * page is written.
 *
 * CI runs this in `Check`, which a path filter of its own starts for a change
 * under `docs/` alone, since the job's main filter leaves Markdown out.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { Nodes } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { Temporal } from "temporal-polyfill";
import { parse as parseYaml } from "yaml";

/** The tree the website publishes, relative to the repository root. */
const ROOT = "docs/en";

/** A positive integer without a leading zero, then lowercase ASCII words. */
const ENTRY_NAME = /^(?<number>[1-9]\d*)-(?<slug>[a-z\d]+(?:-[a-z\d]+)*)$/u;

const PAGE_EXTENSION = ".md";

const INDEX = "index.md";

const IMAGE_EXTENSIONS = new Set([
  ".avif",
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp",
]);

const DATE = /^\d{4}-\d{2}-\d{2}$/u;

/** Every key the frontmatter may carry, and whether a page must. */
const KEYS: Record<string, boolean> = {
  description: true,
  published: true,
  title: true,
  updated: false,
};

export interface Finding {
  file: string;
  line?: number;
  message: string;
}

interface Frontmatter {
  /** The lines the frontmatter takes up, its two `---` fences included. */
  lines: number;
  values: unknown;
}

/**
 * The YAML between a leading pair of `---` fences, or `null` when the page does
 * not open with one.
 */
const splitFrontmatter = (
  source: string
): Frontmatter | { error: string } | null => {
  const lines = source.split(/\r?\n/u);
  if (lines[0] !== "---") {
    return null;
  }
  const end = lines.indexOf("---", 1);
  if (end === -1) {
    return { error: "The frontmatter has no closing `---`." };
  }
  try {
    return {
      lines: end + 1,
      values: parseYaml(lines.slice(1, end).join("\n")),
    };
  } catch (error) {
    return {
      error: `The frontmatter is not valid YAML: ${(error as Error).message}`,
    };
  }
};

/**
 * A `YYYY-MM-DD` string that names a day on the calendar, or `null`.
 *
 * `yaml` reads an unquoted `2026-10-04` as a string, the way the website's
 * `remark-mdx-frontmatter` does, so a date written either way arrives here as
 * one.
 */
const parseDate = (value: unknown): Temporal.PlainDate | null => {
  if (typeof value !== "string" || !DATE.test(value)) {
    return null;
  }
  try {
    return Temporal.PlainDate.from(value, { overflow: "reject" });
  } catch {
    return null;
  }
};

/** What is wrong with the set of keys: an unknown one, or a required one missing. */
const checkKeys = (record: Record<string, unknown>): string[] => [
  ...Object.keys(record)
    .filter((key) => !(key in KEYS))
    .map(
      (key) =>
        `\`${key}\` is not a frontmatter key. A page carries ${Object.keys(KEYS)
          .map((known) => `\`${known}\``)
          .join(", ")} and nothing else.`
    ),
  ...Object.entries(KEYS)
    .filter(([key, required]) => required && !(key in record))
    .map(([key]) => `The frontmatter has no \`${key}\`.`),
];

const checkText = (record: Record<string, unknown>): string[] =>
  ["title", "description"]
    .filter((key) => {
      const value = record[key];

      return (
        key in record &&
        (typeof value !== "string" ||
          value.trim() === "" ||
          value.includes("\n"))
      );
    })
    .map((key) => `\`${key}\` is not a single line of text.`);

const checkDates = (record: Record<string, unknown>): string[] => {
  const messages: string[] = [];
  const published = parseDate(record.published);
  if ("published" in record && !published) {
    messages.push("`published` is not a `YYYY-MM-DD` date.");
  }
  const updated = parseDate(record.updated);
  if ("updated" in record && !updated) {
    messages.push("`updated` is not a `YYYY-MM-DD` date.");
  }
  if (
    published &&
    updated &&
    Temporal.PlainDate.compare(updated, published) < 0
  ) {
    messages.push("`updated` is earlier than `published`.");
  }

  return messages;
};

const checkFrontmatter = (file: string, values: unknown): Finding[] => {
  if (typeof values !== "object" || values === null || Array.isArray(values)) {
    return [
      { file, line: 1, message: "The frontmatter is not a map of keys." },
    ];
  }
  const record = values as Record<string, unknown>;

  return [
    ...checkKeys(record),
    ...checkText(record),
    ...checkDates(record),
  ].map((message) => ({ file, line: 1, message }));
};

/** A link target a reader follows, as the page spells it. */
export interface Link {
  /** Whether it is the source of an image rather than a link to a page. */
  image: boolean;
  line: number;
  url: string;
}

const visit = (node: Nodes, onNode: (node: Nodes) => void): void => {
  onNode(node);
  if ("children" in node) {
    for (const child of node.children) {
      visit(child, onNode);
    }
  }
};

/**
 * The findings that can be told from the page alone, and the links it makes,
 * which only the tree around it can resolve.
 */
export const checkPage = (
  file: string,
  source: string
): { findings: Finding[]; links: Link[] } => {
  const frontmatter = splitFrontmatter(source);
  if (!frontmatter) {
    return {
      findings: [
        {
          file,
          line: 1,
          message:
            "The page does not open with a `---` frontmatter block carrying `title`, `description`, and `published`.",
        },
      ],
      links: [],
    };
  }
  if ("error" in frontmatter) {
    return {
      findings: [{ file, line: 1, message: frontmatter.error }],
      links: [],
    };
  }

  const findings = checkFrontmatter(file, frontmatter.values);

  // Blank lines stand in for the frontmatter, so the body is parsed on its own
  // while every position still names the line in the file.
  const body = [
    ...Array.from({ length: frontmatter.lines }, () => ""),
    ...source.split(/\r?\n/u).slice(frontmatter.lines),
  ].join("\n");
  const tree = fromMarkdown(body, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });

  const links: Link[] = [];
  visit(tree, (node) => {
    const line = node.position?.start.line ?? 1;
    if (node.type === "heading" && node.depth === 1) {
      findings.push({
        file,
        line,
        message:
          "The body has a `#` heading. `title` is the page's heading; the body starts at `##`.",
      });
    }
    if (node.type === "link" || node.type === "definition") {
      links.push({ image: false, line, url: node.url });
    }
    if (node.type === "image") {
      links.push({ image: true, line, url: node.url });
    }
  });

  return { findings, links };
};

const SCHEME = /^[a-z][\d+.a-z-]*:/iu;

const exists = async (file: string): Promise<boolean> => {
  try {
    const stats = await stat(file);

    return stats.isFile();
  } catch {
    return false;
  }
};

/**
 * The finding for a link that the website cannot rewrite or that leads nowhere,
 * or `null` for one it can follow. Absolute URLs and same-page fragments are
 * left alone: neither is resolved against the tree.
 */
const checkLink = async (
  repository: string,
  file: string,
  link: Link
): Promise<Finding | null> => {
  const { line, url } = link;
  if (
    url === "" ||
    url.startsWith("#") ||
    SCHEME.test(url) ||
    url.startsWith("//")
  ) {
    return null;
  }
  const report = (message: string): Finding => ({ file, line, message });
  if (url.startsWith("/")) {
    return report(
      `\`${url}\` is rooted at the repository. Link to a page by a path relative to this file, and to source code by an absolute https://github.com/publira/publira/ URL.`
    );
  }

  const [target = ""] = url.split(/[#?]/u);
  let decoded = target;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    // A malformed escape is looked up as written, and reported as missing.
  }
  const resolved = path.join(
    path.dirname(path.join(repository, file)),
    decoded
  );
  const root = path.join(repository, ROOT);
  if (path.relative(root, resolved).startsWith("..")) {
    return report(
      `\`${url}\` leaves ${ROOT}/, which the website does not serve. Link to source code by an absolute https://github.com/publira/publira/ URL.`
    );
  }
  if (!link.image && path.extname(decoded) !== PAGE_EXTENSION) {
    return report(
      `\`${url}\` is not a \`.md\` file. Link to the page itself — a directory by its \`index.md\` — so the website can rewrite the link to its URL.`
    );
  }
  if (!(await exists(resolved))) {
    return report(`\`${url}\` does not exist.`);
  }

  return null;
};

/**
 * The findings about the names in one directory and every directory below it,
 * and the pages they hold.
 */
const checkDirectory = async (
  repository: string,
  directory: string,
  root = false
): Promise<{ findings: Finding[]; pages: string[] }> => {
  const entries = await readdir(path.join(repository, directory), {
    withFileTypes: true,
  });
  const findings: Finding[] = [];
  const pages: string[] = [];
  const directories: string[] = [];
  const numbers = new Map<string, string>();
  const slugs = new Map<string, string>();

  // `docs/en/` itself is the website's to title, so it may go without a page.
  if (
    !(root || entries.some((entry) => entry.isFile() && entry.name === INDEX))
  ) {
    findings.push({
      file: directory,
      message:
        "The directory has no `index.md`, so its URL resolves to no page and the navigation has no title for it.",
    });
  }

  for (const entry of entries) {
    const entryPath = path.posix.join(directory, entry.name);
    const extension = path.extname(entry.name);
    if (entry.isFile() && entry.name === INDEX) {
      pages.push(entryPath);
      continue;
    }
    if (entry.isFile() && IMAGE_EXTENSIONS.has(extension.toLowerCase())) {
      continue;
    }

    const stem = entry.isFile()
      ? path.basename(entry.name, PAGE_EXTENSION)
      : entry.name;
    const name = ENTRY_NAME.exec(stem);
    if (!name?.groups || (entry.isFile() && extension !== PAGE_EXTENSION)) {
      findings.push({
        file: entryPath,
        message: entry.isDirectory()
          ? "A directory is named `<n>-<slug>`: a positive integer, then lowercase ASCII words joined by `-`."
          : "A file is `index.md`, an image, or a page named `<n>-<slug>.md`: a positive integer, then lowercase ASCII words joined by `-`.",
      });
      continue;
    }

    const { number = "", slug = "" } = name.groups;
    const sameNumber = numbers.get(number);
    if (sameNumber) {
      findings.push({
        file: entryPath,
        message: `${sameNumber} has the number ${number} already. Numbers are unique among siblings; a gap is fine.`,
      });
    }
    numbers.set(number, entryPath);
    const sameSlug = slugs.get(slug);
    if (sameSlug) {
      findings.push({
        file: entryPath,
        message: `${sameSlug} has the slug \`${slug}\` already, so both would be published at the same URL.`,
      });
    }
    slugs.set(slug, entryPath);

    (entry.isDirectory() ? directories : pages).push(entryPath);
  }

  const nested = await Promise.all(
    directories.map((child) => checkDirectory(repository, child))
  );

  return {
    findings: [...findings, ...nested.flatMap((child) => child.findings)],
    pages: [...pages, ...nested.flatMap((child) => child.pages)],
  };
};

const checkFile = async (
  repository: string,
  file: string
): Promise<Finding[]> => {
  const source = await readFile(path.join(repository, file), "utf-8");
  const { findings, links } = checkPage(file, source);
  const broken = await Promise.all(
    links.map((link) => checkLink(repository, file, link))
  );

  return [...findings, ...broken.filter((finding) => finding !== null)];
};

/**
 * Every finding under `root`, relative to `repository`, as are the files the
 * findings name, in the order of those files and lines.
 */
export const scan = async (
  repository = process.cwd(),
  root = ROOT
): Promise<Finding[]> => {
  const { findings, pages } = await checkDirectory(repository, root, true);
  const inPages = await Promise.all(
    pages.map((page) => checkFile(repository, page))
  );

  return [...findings, ...inPages.flat()].toSorted(
    (a, b) =>
      a.file.localeCompare(b.file, "en") || (a.line ?? 0) - (b.line ?? 0)
  );
};

const report = (finding: Finding): void => {
  if (process.env.GITHUB_ACTIONS) {
    const line = finding.line === undefined ? "" : `,line=${finding.line}`;
    console.error(`::error file=${finding.file}${line}::${finding.message}`);

    return;
  }
  const line = finding.line === undefined ? "" : `:${finding.line}`;
  console.error(`${finding.file}${line}: ${finding.message}`);
};

const main = async (): Promise<void> => {
  const findings = await scan();

  if (findings.length > 0) {
    for (const finding of findings) {
      report(finding);
    }
    process.exitCode = 1;

    return;
  }

  console.log(`${ROOT}: every page follows the contract in docs/README.md.`);
};

/**
 * The unit test imports {@link checkPage} and {@link scan} rather than running
 * the check, so it only starts when this file is the program.
 */
if (process.argv[1] === import.meta.filename) {
  await main();
}
