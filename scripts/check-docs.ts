/**
 * Fail on a page under `docs/en/` that breaks the contract the website reads it by.
 *
 *     node scripts/check-docs.ts
 *
 * `docs/README.md` states that contract: the `<n>-<slug>` names the URLs are
 * derived from, an `index.md` in every directory, the frontmatter keys, the
 * relative links the website rewrites to page URLs, and the images beside the
 * pages that show them. Every one of those is
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

import type { Definition, ImageReference, LinkReference, Nodes } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { Temporal } from "temporal-polyfill";
import { parse as parseYaml } from "yaml";

/** The tree the website publishes, relative to the repository root. */
const ROOT = "docs/en";

/** A positive integer without a leading zero, then lowercase ASCII words. */
const ENTRY_NAME = /^(?<number>[1-9]\d*)-(?<slug>[a-z\d]+(?:-[a-z\d]+)*)$/u;

/** What follows the page's slug in an image's name: lowercase ASCII words. */
const SUBJECT = /^[a-z\d]+(?:-[a-z\d]+)*$/u;

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
  const definitions = new Map<string, Definition>();
  const references: (ImageReference | LinkReference)[] = [];
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
    if (node.type === "link" || node.type === "image") {
      links.push({ image: node.type === "image", line, url: node.url });
    }
    // The alt text is the reference's own, so a definition two images share
    // can still leave one of them without any.
    if (
      (node.type === "image" || node.type === "imageReference") &&
      !node.alt?.trim()
    ) {
      findings.push({
        file,
        line,
        message:
          "The image has no alt text. Say what it shows in the brackets, for a reader who cannot see it.",
      });
    }
    // CommonMark lets the first of two definitions with one label win.
    if (node.type === "definition" && !definitions.has(node.identifier)) {
      definitions.set(node.identifier, node);
    }
    if (node.type === "linkReference" || node.type === "imageReference") {
      references.push(node);
    }
  });

  // A definition is a link or an image only by how it is referenced, so each
  // way it is used is checked once, on the line its URL is written on. One
  // nothing references is never rendered, and is left alone.
  const resolved = new Set<string>();
  for (const reference of references) {
    const definition = definitions.get(reference.identifier);
    const image = reference.type === "imageReference";
    const key = `${reference.identifier}:${image}`;
    if (definition && !resolved.has(key)) {
      resolved.add(key);
      links.push({
        image,
        line: definition.position?.start.line ?? 1,
        url: definition.url,
      });
    }
  }

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

/** Where a link leads, relative to the repository, or why it leads nowhere. */
type Resolved = { finding: Finding } | { target: string } | null;

/**
 * The file a link resolves to, the finding for a link that the website cannot
 * rewrite or that leads nowhere, or `null` for one it follows without the
 * tree. Absolute URLs and same-page fragments are such links. An image never
 * is: one the tree does not hold is one the website cannot serve.
 */
const checkLink = async (
  repository: string,
  file: string,
  link: Link
): Promise<Resolved> => {
  const { line, url } = link;
  const report = (message: string): Resolved => ({
    finding: { file, line, message },
  });
  if (
    url === "" ||
    url.startsWith("#") ||
    SCHEME.test(url) ||
    url.startsWith("//")
  ) {
    return link.image
      ? report(
          `\`${url}\` is not a file in ${ROOT}/. An image sits beside the page that shows it and is referenced by a relative path.`
        )
      : null;
  }
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
  const extension = path.extname(decoded);
  if (link.image && !IMAGE_EXTENSIONS.has(extension.toLowerCase())) {
    return report(
      `\`${url}\` is not an image. An image is one of ${[...IMAGE_EXTENSIONS].join(", ")}, beside the page that shows it.`
    );
  }
  if (!link.image && extension !== PAGE_EXTENSION) {
    return report(
      `\`${url}\` is not a \`.md\` file. Link to the page itself — a directory by its \`index.md\` — so the website can rewrite the link to its URL.`
    );
  }
  if (!(await exists(resolved))) {
    return report(`\`${url}\` does not exist.`);
  }

  return {
    target: path.relative(repository, resolved).split(path.sep).join("/"),
  };
};

/**
 * The findings for the images whose names tie them to no page beside them.
 *
 * `<page slug>-<subject>`, and `index-<subject>` for an `index.md`: the number
 * is left out so reordering the pages renames no image, and the slug keeps the
 * images of sibling pages apart in one directory.
 */
const checkImageNames = (
  images: readonly string[],
  pageSlugs: readonly string[]
): Finding[] => {
  const named = (image: string): boolean => {
    const stem = path.posix.basename(image, path.posix.extname(image));

    return pageSlugs.some(
      (slug) =>
        stem.startsWith(`${slug}-`) && SUBJECT.test(stem.slice(slug.length + 1))
    );
  };
  const slugs =
    pageSlugs
      .toSorted((a, b) => a.localeCompare(b, "en"))
      .map((slug) => `\`${slug}\``)
      .join(", ") || "there is none";

  return images
    .filter((image) => !named(image))
    .map((image) => ({
      file: image,
      message: `An image is named \`<page slug>-<subject>\` after a page beside it (${slugs}), with a subject of lowercase ASCII words joined by \`-\`.`,
    }));
};

/**
 * The findings about the names in one directory and every directory below it,
 * and the pages and images they hold.
 */
const checkDirectory = async (
  repository: string,
  directory: string,
  root = false
): Promise<{ findings: Finding[]; images: string[]; pages: string[] }> => {
  const entries = await readdir(path.join(repository, directory), {
    withFileTypes: true,
  });
  const findings: Finding[] = [];
  const pages: string[] = [];
  const images: string[] = [];
  const pageSlugs: string[] = [];
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
      pageSlugs.push("index");
      continue;
    }
    if (entry.isFile() && IMAGE_EXTENSIONS.has(extension.toLowerCase())) {
      images.push(entryPath);
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

    if (entry.isDirectory()) {
      directories.push(entryPath);
    } else {
      pages.push(entryPath);
      pageSlugs.push(slug);
    }
  }

  findings.push(...checkImageNames(images, pageSlugs));

  const nested = await Promise.all(
    directories.map((child) => checkDirectory(repository, child))
  );

  return {
    findings: [...findings, ...nested.flatMap((child) => child.findings)],
    images: [...images, ...nested.flatMap((child) => child.images)],
    pages: [...pages, ...nested.flatMap((child) => child.pages)],
  };
};

/** The findings in one page, and the images beside it that it shows. */
const checkFile = async (
  repository: string,
  file: string
): Promise<{ findings: Finding[]; images: string[] }> => {
  const source = await readFile(path.join(repository, file), "utf-8");
  const { findings, links } = checkPage(file, source);
  const resolved = await Promise.all(
    links.map(async (link) => ({
      image: link.image,
      resolved: await checkLink(repository, file, link),
    }))
  );

  return {
    findings: [
      ...findings,
      ...resolved.flatMap(({ resolved: result }) =>
        result && "finding" in result ? [result.finding] : []
      ),
    ],
    images: resolved.flatMap(({ image, resolved: result }) =>
      image &&
      result &&
      "target" in result &&
      path.posix.dirname(result.target) === path.posix.dirname(file)
        ? [result.target]
        : []
    ),
  };
};

/**
 * The findings for images no page beside them shows.
 *
 * Playwright never deletes a screenshot its spec stops taking, and nothing
 * else notices an image a page stops showing, so this is what catches what
 * either leaves behind. A page in another directory does not count: an image
 * sits beside the page that shows it.
 */
const checkUnreferenced = (
  images: readonly string[],
  shown: ReadonlySet<string>
): Finding[] =>
  images
    .filter((image) => !shown.has(image))
    .map((image) => ({
      file: image,
      message:
        "No page beside the image shows it. Reference it from the page it was made for, or delete it.",
    }));

/**
 * Every finding under `root`, relative to `repository`, as are the files the
 * findings name, in the order of those files and lines.
 */
export const scan = async (
  repository = process.cwd(),
  root = ROOT
): Promise<Finding[]> => {
  const { findings, images, pages } = await checkDirectory(
    repository,
    root,
    true
  );
  const inPages = await Promise.all(
    pages.map((page) => checkFile(repository, page))
  );
  const shown = new Set(inPages.flatMap((page) => page.images));

  return [
    ...findings,
    ...inPages.flatMap((page) => page.findings),
    ...checkUnreferenced(images, shown),
  ].toSorted(
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
