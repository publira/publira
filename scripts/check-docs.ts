/**
 * Fail on a page under `docs/<locale>/` that breaks the contract the website
 * reads it by, on a translated tree that has fallen out of step with
 * `docs/en/`, or on a link in the repository's Markdown that leads to no file
 * or no heading.
 *
 *     pnpm docs:check
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
 * The pages send a reader to the READMEs for the full reference, by absolute
 * `https://github.com/publira/publira/blob/main/` URLs and mostly to a heading,
 * and the READMEs, the `AGENTS.md` files, `CONTRIBUTING.md`, and the skills
 * link to each other's headings by relative paths. Neither kind of link breaks
 * anything that fails when a heading is renamed or a file moves, so both are
 * resolved here against the checkout, the heading by the anchor GitHub and the
 * website's `rehype-slug` derive from it.
 *
 * A translated tree, `docs/ja/` and any other locale's beside it, follows the
 * same contract and holds the same pages and images as `docs/en/`, and each of
 * its pages records the English text it was translated from by that page's
 * date, so a change to the English page that a reader should notice leaves
 * the translation reported here until it catches up.
 *
 * A page whose commands CI runs shows them as a code block that a script keeps
 * between a `# quoted by <page>` comment and `# end of quote`, and the block
 * has to read the same as those lines, so a change to either is a change to
 * both.
 *
 * CI runs this in `Check`, which a path filter of its own starts for a change
 * to Markdown or under `docs/` alone, and for a deletion or a rename anywhere,
 * since the job's main filter leaves Markdown out.
 */

import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type {
  Definition,
  ImageReference,
  LinkReference,
  Nodes,
  Root,
} from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { Temporal } from "temporal-polyfill";
import { parse as parseYaml } from "yaml";

import { isJsonObject, isJsonString } from "./json-value.ts";
import type { JsonObject, JsonValue } from "./json-value.ts";

/** The directory every locale's tree sits in, relative to the repository root. */
const DOCS = "docs";

/** The locale every page is written in first, and every other tree translates. */
const SOURCE_LOCALE = "en";

/** The tree every translation follows, relative to the repository root. */
const SOURCE = `${DOCS}/${SOURCE_LOCALE}`;

/** The message catalogs the UI ships, one `<locale>.json` per locale. */
const CATALOGS = "locales";

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

/**
 * A page's URL below the version segment, as `redirect_from` names one: each
 * slug after a `/`, with neither a number nor a trailing `/`.
 */
const URL_PATH = /^(?:\/[a-z\d]+(?:-[a-z\d]+)*)+$/u;

/** Every key the frontmatter may carry, and whether a page must. */
const KEYS = {
  description: true,
  published: true,
  redirect_from: false,
  title: true,
  updated: false,
} satisfies Record<string, boolean>;

/**
 * The key a translated page carries besides {@link KEYS}, and must: the
 * `updated` date of the English page it follows, or its `published` date while
 * it has none. That date moves whenever the English page changes in a way a
 * reader should notice, so a translation that names an earlier one has not
 * caught up with it.
 */
const SOURCE_UPDATED = "source_updated";

export interface Finding {
  file: string;
  line?: number;
  message: string;
}

interface Frontmatter {
  values: JsonValue;
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
      values: parseYaml(lines.slice(1, end).join("\n")),
    };
  } catch (error) {
    return {
      error: `The frontmatter is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

/**
 * The lines a leading frontmatter block takes up, its two `---` fences
 * included, or `0` when the file does not open with a closed one.
 */
const frontmatterLength = (lines: readonly string[]): number => {
  if (lines[0] !== "---") {
    return 0;
  }

  const end = lines.indexOf("---", 1);

  return end === -1 ? 0 : end + 1;
};

/**
 * The Markdown tree of a file without its frontmatter, which GitHub and the
 * website do not render as Markdown. Blank lines stand in for it, so the body
 * is parsed on its own while every position still names the line in the file.
 */
const parseMarkdown = (source: string): Root => {
  const lines = source.split(/\r?\n/u);
  const length = frontmatterLength(lines);

  return fromMarkdown(
    [...Array.from({ length }, () => ""), ...lines.slice(length)].join("\n"),
    {
      extensions: [gfm()],
      mdastExtensions: [gfmFromMarkdown()],
    }
  );
};

/**
 * A `YYYY-MM-DD` string that names a day on the calendar, or `null`.
 *
 * `yaml` reads an unquoted `2026-10-04` as a string, the way the website's
 * `remark-mdx-frontmatter` does, so a date written either way arrives here as
 * one.
 */
const parseDate = (value: JsonValue | undefined): Temporal.PlainDate | null => {
  if (!isJsonString(value) || !DATE.test(value)) {
    return null;
  }

  try {
    return Temporal.PlainDate.from(value, { overflow: "reject" });
  } catch {
    return null;
  }
};

/** The tree a file under `docs/` sits in, such as `docs/en`. */
const treeOf = (file: string): string => file.split("/").slice(0, 2).join("/");

/** Whether a file under `docs/` is in a translated tree rather than `docs/en/`. */
const isTranslated = (file: string): boolean => treeOf(file) !== SOURCE;

/**
 * What is wrong with the set of keys: an unknown one, or a required one
 * missing. A translated page carries {@link SOURCE_UPDATED} too.
 */
const checkKeys = (record: JsonObject, translated: boolean): string[] => {
  const keys: Record<string, boolean> = translated
    ? { ...KEYS, [SOURCE_UPDATED]: true }
    : KEYS;

  return [
    ...Object.keys(record)
      .filter((key) => !(key in keys))
      .map(
        (key) =>
          `\`${key}\` is not a frontmatter key. A page ${translated ? "in a translated tree " : ""}carries ${Object.keys(
            keys
          )
            .toSorted()
            .map((known) => `\`${known}\``)
            .join(", ")} and nothing else.`
      ),
    ...Object.entries(keys)
      .filter(([key, required]) => required && !(key in record))
      .map(([key]) => `The frontmatter has no \`${key}\`.`),
  ];
};

const checkText = (record: JsonObject): string[] =>
  ["title", "description"].flatMap((key) => {
    const value = record[key];

    return key in record &&
      (!isJsonString(value) || value.trim() === "" || value.includes("\n"))
      ? [`\`${key}\` is not a single line of text.`]
      : [];
  });

const checkDates = (record: JsonObject): string[] => {
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

  if (SOURCE_UPDATED in record && !parseDate(record[SOURCE_UPDATED])) {
    messages.push(`\`${SOURCE_UPDATED}\` is not a \`YYYY-MM-DD\` date.`);
  }

  return messages;
};

/**
 * The date of the English text a page carries: its own `updated`, or
 * `published` while it has none, for a page in `docs/en/`, and the
 * {@link SOURCE_UPDATED} it records for a translation. `null` when that date is
 * missing or malformed, which {@link checkDates} reports already.
 */
const revisionOf = (record: JsonObject, translated: boolean): string | null => {
  const value = translated
    ? record[SOURCE_UPDATED]
    : (record.updated ?? record.published);

  return isJsonString(value) && parseDate(value) ? value : null;
};

interface Redirects {
  messages: string[];
  redirects: string[];
}

/**
 * The URLs `redirect_from` names, and what is wrong with how it names them.
 *
 * Each one is a URL the page was published at before it was renamed or moved,
 * which the website redirects to the page. What it collides with is a question
 * for the whole tree, so {@link scan} asks it.
 */
const checkRedirects = (record: JsonObject): Redirects => {
  if (!("redirect_from" in record)) {
    return { messages: [], redirects: [] };
  }

  const value = record.redirect_from;

  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every(isJsonString)
  ) {
    return {
      messages: [
        "`redirect_from` is not a list of the URLs the page was published at before.",
      ],
      redirects: [],
    };
  }

  const messages: string[] = [];
  const redirects: string[] = [];

  for (const entry of value) {
    if (!URL_PATH.test(entry)) {
      messages.push(
        `\`${entry}\` in \`redirect_from\` is not a URL below the version, such as \`/deployments/reverse-proxy\`: each slug after a \`/\`, without numbers or a trailing \`/\`.`
      );
    } else if (redirects.includes(entry)) {
      messages.push(`\`${entry}\` is in \`redirect_from\` twice.`);
    } else {
      redirects.push(entry);
    }
  }

  return { messages, redirects };
};

interface CheckedFrontmatter {
  findings: Finding[];
  redirects: string[];
  revision: string | null;
}

const checkFrontmatter = (
  file: string,
  values: JsonValue
): CheckedFrontmatter => {
  if (!isJsonObject(values)) {
    return {
      findings: [
        { file, line: 1, message: "The frontmatter is not a map of keys." },
      ],
      redirects: [],
      revision: null,
    };
  }

  const translated = isTranslated(file);
  const { messages, redirects } = checkRedirects(values);

  return {
    findings: [
      ...checkKeys(values, translated),
      ...checkText(values),
      ...checkDates(values),
      ...messages,
    ].map((message) => ({ file, line: 1, message })),
    redirects,
    revision: revisionOf(values, translated),
  };
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
 * Every link and image in a tree, in the order they are written, then every
 * definition by the way it is referenced.
 *
 * A definition is a link or an image only by how it is referenced, so each way
 * it is used is collected once, on the line its URL is written on. One nothing
 * references is never rendered, and is left alone.
 */
const collectLinks = (tree: Root): Link[] => {
  const links: Link[] = [];
  const definitions = new Map<string, Definition>();
  const references: (ImageReference | LinkReference)[] = [];
  visit(tree, (node) => {
    if (node.type === "link" || node.type === "image") {
      links.push({
        image: node.type === "image",
        line: node.position?.start.line ?? 1,
        url: node.url,
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

  return links;
};

/**
 * The text a heading's anchor is derived from: what it reads as once rendered,
 * so the code in it counts and the markup around it, an image, and inline HTML
 * do not.
 */
const headingText = (node: Nodes): string => {
  if (node.type === "text" || node.type === "inlineCode") {
    return node.value;
  }

  if (node.type === "html" || node.type === "image") {
    return "";
  }

  return "children" in node ? node.children.map(headingText).join("") : "";
};

/**
 * What GitHub drops from a heading's lowercased text on the way to its anchor:
 * everything but a letter, a combining mark, a digit, a connector such as `_`,
 * a space, and `-`. It is the class `github-slugger` strips, which the
 * website's `rehype-slug` uses too.
 */
const NOT_IN_ANCHOR = /[^\p{L}\p{M}\p{N}\p{Pc} -]/gu;

/**
 * The anchor of every heading in a Markdown file, in order: its text
 * lowercased, without punctuation, with each space turned into a `-`, and with
 * `-1`, `-2`, and so on after one an earlier heading took already.
 */
export const headingAnchors = (source: string): string[] => {
  const anchors: string[] = [];
  const taken = new Set<string>();
  const repeats = new Map<string, number>();
  visit(parseMarkdown(source), (node) => {
    if (node.type !== "heading") {
      return;
    }

    const base = headingText(node)
      .toLowerCase()
      .replaceAll(NOT_IN_ANCHOR, "")
      .replaceAll(" ", "-");

    let anchor = base;

    while (taken.has(anchor)) {
      const repeat = (repeats.get(base) ?? 0) + 1;
      repeats.set(base, repeat);
      anchor = `${base}-${repeat}`;
    }

    taken.add(anchor);
    anchors.push(anchor);
  });

  return anchors;
};

/** What {@link checkPage} finds in a page, and what it leaves to the tree. */
export interface CheckedPage {
  findings: Finding[];
  links: Link[];
  redirects: string[];
  /** The date of the English text the page carries, as {@link revisionOf} reads it. */
  revision: string | null;
}

/**
 * The findings that can be told from the page alone, and the links it makes,
 * the former URLs it redirects from, and the English text it carries, which
 * only the trees around it can resolve.
 */
export const checkPage = (file: string, source: string): CheckedPage => {
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
      redirects: [],
      revision: null,
    };
  }

  if ("error" in frontmatter) {
    return {
      findings: [{ file, line: 1, message: frontmatter.error }],
      links: [],
      redirects: [],
      revision: null,
    };
  }

  const { findings, redirects, revision } = checkFrontmatter(
    file,
    frontmatter.values
  );

  const tree = parseMarkdown(source);
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
  });

  return { findings, links: collectLinks(tree), redirects, revision };
};

const SCHEME = /^[a-z][\d+.a-z-]*:/iu;

/**
 * The start of an absolute URL to a path on `main` in this repository, which a
 * checkout of `main` holds. A URL to another branch, a tag, or a commit names a
 * tree the checkout may not have, and is not resolved.
 */
const MAIN_URL =
  /^https:\/\/github\.com\/publira\/publira\/(?:blob|tree)\/main(?:\/|(?=[?#]|$))/u;

/** A fragment GitHub reads as a line or a range of lines, not as a heading. */
const LINE_FRAGMENT = /^L\d+(?:C\d+)?(?:-L\d+(?:C\d+)?)?$/u;

/**
 * What a scan reads once and every link it resolves shares: the repository,
 * and the anchors of each Markdown file a fragment names.
 */
interface Context {
  anchors: (target: string) => Promise<ReadonlySet<string>>;
  repository: string;
}

const createContext = (repository: string): Context => {
  const anchors = new Map<string, Promise<ReadonlySet<string>>>();

  return {
    anchors: (target) => {
      const cached = anchors.get(target);

      if (cached) {
        return cached;
      }

      const read = (async () =>
        new Set(
          headingAnchors(await readFile(path.join(repository, target), "utf-8"))
        ))();

      anchors.set(target, read);

      return read;
    },
    repository,
  };
};

const decode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    // A malformed escape is looked up as written, and reported as missing.
    return value;
  }
};

/** Where a link leads in the repository, `/`-separated, and to which heading. */
interface Destination {
  /** The anchor the URL names, or `null` when it names none. */
  fragment: string | null;
  target: string;
}

interface UrlParts {
  fragment: string | null;
  path: string;
}

/** A URL's path and its fragment, each decoded, with any query left out. */
const splitUrl = (url: string): UrlParts => {
  const hash = url.indexOf("#");
  const [before = ""] = (hash === -1 ? url : url.slice(0, hash)).split("?");
  const fragment = hash === -1 ? "" : decode(url.slice(hash + 1));

  return { fragment: fragment === "" ? null : fragment, path: decode(before) };
};

/** Where an absolute URL to `main` in this repository leads, or `null` for any other URL. */
const mainDestination = (url: string): Destination | null => {
  const start = MAIN_URL.exec(url);

  if (!start) {
    return null;
  }

  const { fragment, path: target } = splitUrl(url.slice(start[0].length));

  return {
    fragment,
    target: path.posix.normalize(target || ".").replace(/(?<=.)\/$/u, ""),
  };
};

const kind = async (file: string): Promise<"directory" | "file" | null> => {
  try {
    const stats = await stat(file);

    if (stats.isFile()) {
      return "file";
    }

    return stats.isDirectory() ? "directory" : null;
  } catch {
    return null;
  }
};

const exists = async (file: string): Promise<boolean> =>
  (await kind(file)) === "file";

/**
 * Why a fragment leads nowhere, or `null` when a heading in the Markdown file
 * produces it. Only a Markdown file is rendered with anchors, and a line
 * fragment names no heading, so any other fragment is left alone.
 */
const checkFragment = async (
  context: Context,
  url: string,
  { fragment, target }: Destination
): Promise<string | null> => {
  if (
    fragment === null ||
    LINE_FRAGMENT.test(fragment) ||
    path.extname(target).toLowerCase() !== PAGE_EXTENSION
  ) {
    return null;
  }

  const anchors = await context.anchors(target);

  return anchors.has(fragment)
    ? null
    : `\`${url}\` names \`#${fragment}\`, which no heading in ${target} produces. Link to the anchor of a heading there: its text lowercased, without punctuation, with each space turned into \`-\`.`;
};

/**
 * Why a link into the repository leads nowhere, or `null` when the file or
 * directory it names exists and any heading it names is in that file.
 */
const checkDestination = async (
  context: Context,
  url: string,
  destination: Destination
): Promise<string | null> => {
  const { target } = destination;

  if (target === ".." || target.startsWith("../")) {
    return `\`${url}\` leaves the repository.`;
  }

  const found = await kind(path.join(context.repository, target));

  if (!found) {
    return `\`${url}\` names ${target}, which is not in the repository.`;
  }

  return found === "file" ? checkFragment(context, url, destination) : null;
};

/** Where a link leads, relative to the repository, or why it leads nowhere. */
type Resolved = { finding: Finding } | { target: string } | null;

/**
 * The file a link resolves to, the finding for a link that the website cannot
 * rewrite or that leads nowhere, or `null` for one it follows without the
 * tree. Absolute URLs and same-page fragments are such links, though a
 * fragment and a URL to `main` in this repository have to lead somewhere. An
 * image never is: one the tree does not hold is one the website cannot serve.
 */
const checkLink = async (
  context: Context,
  file: string,
  link: Link
): Promise<Resolved> => {
  const { line, url } = link;
  const tree = treeOf(file);

  const report = (message: string | null): Resolved =>
    message === null ? null : { finding: { file, line, message } };

  const main = mainDestination(url);

  if (
    url === "" ||
    url.startsWith("#") ||
    main ||
    SCHEME.test(url) ||
    url.startsWith("//")
  ) {
    if (link.image) {
      return report(
        `\`${url}\` is not a file in ${tree}/. An image sits beside the page that shows it and is referenced by a relative path.`
      );
    }

    if (main) {
      return report(await checkDestination(context, url, main));
    }

    return url.startsWith("#")
      ? report(
          await checkFragment(context, url, {
            fragment: splitUrl(url).fragment,
            target: file,
          })
        )
      : null;
  }

  if (url.startsWith("/")) {
    return report(
      `\`${url}\` is rooted at the repository. Link to a page by a path relative to this file, and to source code by an absolute https://github.com/publira/publira/ URL.`
    );
  }

  const { fragment, path: decoded } = splitUrl(url);

  const resolved = path.join(
    path.dirname(path.join(context.repository, file)),
    decoded
  );

  const root = path.join(context.repository, tree);

  if (path.relative(root, resolved).startsWith("..")) {
    return report(
      `\`${url}\` leaves ${tree}/, which the website does not serve. Link to source code by an absolute https://github.com/publira/publira/ URL.`
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

  const target = path
    .relative(context.repository, resolved)
    .split(path.sep)
    .join("/");

  const missing = link.image
    ? null
    : await checkFragment(context, url, { fragment, target });

  return missing === null ? { target } : report(missing);
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
  const directories: string[] = [];
  const numbers = new Map<string, string>();
  const slugs = new Map<string, string>();

  // A locale's tree itself is the website's to title, so it may go without a page.
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

    (entry.isDirectory() ? directories : pages).push(entryPath);
  }

  const nested = await Promise.all(
    directories.map((child) => checkDirectory(repository, child))
  );

  return {
    findings: [...findings, ...nested.flatMap((child) => child.findings)],
    images: [...images, ...nested.flatMap((child) => child.images)],
    pages: [...pages, ...nested.flatMap((child) => child.pages)],
  };
};

/**
 * The findings in one page, the images beside it that it shows, the former
 * URLs it redirects from, and the English text it carries.
 */
const checkFile = async (
  context: Context,
  file: string
): Promise<{
  findings: Finding[];
  images: string[];
  redirects: string[];
  revision: string | null;
}> => {
  const source = await readFile(path.join(context.repository, file), "utf-8");
  const { findings, links, redirects, revision } = checkPage(file, source);

  const resolved = await Promise.all(
    links.map(async (link) => ({
      image: link.image,
      resolved: await checkLink(context, file, link),
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
    redirects,
    revision,
  };
};

/** A page's slug, the name its images start with: `index` for an `index.md`. */
const pageSlug = (page: string): string => {
  const name = path.posix.basename(page, PAGE_EXTENSION);

  return name === path.posix.basename(INDEX, PAGE_EXTENSION)
    ? name
    : (ENTRY_NAME.exec(name)?.groups?.slug ?? name);
};

/**
 * A page's URL below the version segment: each slug of its path after a `/`,
 * with an `index.md` standing for its directory.
 */
const pageUrlPath = (root: string, page: string): string => {
  const slugs = path.posix
    .relative(root, page)
    .split("/")
    .filter((segment) => segment !== INDEX)
    .map((segment) => {
      const stem = path.posix.basename(segment, PAGE_EXTENSION);

      return ENTRY_NAME.exec(stem)?.groups?.slug ?? stem;
    });

  return `/${slugs.join("/")}`;
};

/**
 * The findings for `redirect_from` entries the website could not honour: one
 * that is the URL of a page the tree still has, which the page there answers
 * rather than the redirect, and one that two pages claim.
 */
const checkRedirectTargets = (
  root: string,
  pages: readonly string[],
  redirects: readonly (readonly string[])[]
): Finding[] => {
  const urls = new Map(pages.map((page) => [pageUrlPath(root, page), page]));
  const claims = new Map<string, string[]>();
  const findings: Finding[] = [];

  for (const [index, page] of pages.entries()) {
    for (const redirect of redirects[index] ?? []) {
      const existing = urls.get(redirect);

      if (existing) {
        findings.push({
          file: page,
          line: 1,
          message: `\`${redirect}\` in \`redirect_from\` is the URL of ${existing}, which the website serves instead of the redirect.`,
        });
      } else {
        claims.set(redirect, [...(claims.get(redirect) ?? []), page]);
      }
    }
  }

  for (const [redirect, claimants] of claims) {
    if (claimants.length > 1) {
      for (const page of claimants) {
        const others = claimants
          .filter((other) => other !== page)
          .toSorted((a, b) => a.localeCompare(b, "en"))
          .join(", ");

        findings.push({
          file: page,
          line: 1,
          message: `${others} redirects from \`${redirect}\` too, so the website could send it to only one of the pages.`,
        });
      }
    }
  }

  return findings;
};

/**
 * The findings for images that no page beside them shows, or that are not
 * named after a page that does.
 *
 * Playwright never deletes a screenshot its spec stops taking, and nothing
 * else notices an image a page stops showing, so this is what catches what
 * either leaves behind. A page in another directory does not count: an image
 * sits beside the page that shows it.
 *
 * The name is `<page slug>-<subject>`, and `index-<subject>` for an
 * `index.md`, after one of the pages that show the image rather than any page
 * in the directory: the number is left out so reordering the pages renames no
 * image, and the slug is what keeps the images of sibling pages apart, which
 * an image named after a sibling it is not on would undo.
 */
const checkImages = (
  images: readonly string[],
  shownBy: ReadonlyMap<string, readonly string[]>
): Finding[] =>
  images.flatMap((image) => {
    const slugs = shownBy.get(image) ?? [];

    if (slugs.length === 0) {
      return [
        {
          file: image,
          message:
            "No page beside the image shows it. Reference it from the page it was made for, or delete it.",
        },
      ];
    }

    const stem = path.posix.basename(image, path.posix.extname(image));

    const named = slugs.some(
      (slug) =>
        stem.startsWith(`${slug}-`) && SUBJECT.test(stem.slice(slug.length + 1))
    );

    if (named) {
      return [];
    }

    const listed = [...new Set(slugs)]
      .toSorted((a, b) => a.localeCompare(b, "en"))
      .map((slug) => `\`${slug}\``)
      .join(", ");

    return [
      {
        file: image,
        message: `An image is named \`<page slug>-<subject>\` after a page that shows it (${listed}), with a subject of lowercase ASCII words joined by \`-\`.`,
      },
    ];
  });

/**
 * The tree of every locale under `docs/`, `docs/en/` included, and a finding for
 * a directory there that names no locale the UI ships a catalog for.
 *
 * The `docs-screenshots` project photographs the consoles in the language of
 * every tree it finds, from that language's catalog, and the website serves
 * every tree under the locale it is named after, so a tree is a locale the
 * consoles can be shown in or a mistake.
 */
const listTrees = async (
  repository: string
): Promise<{ findings: Finding[]; trees: string[] }> => {
  const entries = await readdir(path.join(repository, DOCS), {
    withFileTypes: true,
  });

  const translations = entries
    .filter((entry) => entry.isDirectory() && entry.name !== SOURCE_LOCALE)
    .map((entry) => entry.name);

  const shipped = await Promise.all(
    translations.map((locale) =>
      exists(path.join(repository, CATALOGS, `${locale}.json`))
    )
  );

  return {
    findings: translations
      .filter((_, index) => !shipped[index])
      .map((locale) => ({
        file: path.posix.join(DOCS, locale),
        message: `\`${locale}\` is not a locale the UI ships, so no \`${CATALOGS}/${locale}.json\` is there to take its screenshots in. A tree under \`${DOCS}/\` is named after a catalog in \`${CATALOGS}/\`.`,
      })),
    trees: [
      SOURCE,
      ...translations
        .filter((_, index) => shipped[index])
        .map((locale) => path.posix.join(DOCS, locale)),
    ].toSorted((a, b) => a.localeCompare(b, "en")),
  };
};

/** What a page in a tree carries that its counterpart in another has to match. */
interface PageEntry {
  redirects: readonly string[];
  revision: string | null;
}

/**
 * Every finding in one locale's tree, and its pages and images by their path
 * within it, which is the path of their counterpart in every other tree.
 */
const checkTree = async (
  context: Context,
  root: string
): Promise<{
  findings: Finding[];
  images: Set<string>;
  pages: Map<string, PageEntry>;
}> => {
  const { findings, images, pages } = await checkDirectory(
    context.repository,
    root,
    true
  );

  const inPages = await Promise.all(
    pages.map((page) => checkFile(context, page))
  );

  const shownBy = new Map<string, string[]>();

  for (const [index, page] of pages.entries()) {
    for (const image of inPages[index]?.images ?? []) {
      shownBy.set(image, [...(shownBy.get(image) ?? []), pageSlug(page)]);
    }
  }

  return {
    findings: [
      ...findings,
      ...inPages.flatMap((page) => page.findings),
      ...checkRedirectTargets(
        root,
        pages,
        inPages.map((page) => page.redirects)
      ),
      ...checkImages(images, shownBy),
    ],
    images: new Set(images.map((image) => path.posix.relative(root, image))),
    pages: new Map(
      pages.map((page, index) => [
        path.posix.relative(root, page),
        {
          redirects: inPages[index]?.redirects ?? [],
          revision: inPages[index]?.revision ?? null,
        },
      ])
    ),
  };
};

/**
 * The findings for a translated tree that is out of step with `docs/en/`.
 *
 * A translation holds every page and every image `docs/en/` holds, under the
 * same names, so each locale publishes the same pages at the same URLs and
 * shows the same screenshots. Each of its pages records, in
 * {@link SOURCE_UPDATED}, the `updated` date of the English page it was last
 * brought in line with, and is behind when the English page's date has moved
 * past it. A page published at the same URL redirects from the same former
 * ones too.
 */
const compareTrees = (
  source: Awaited<ReturnType<typeof checkTree>>,
  root: string,
  translation: Awaited<ReturnType<typeof checkTree>>
): Finding[] => {
  const findings: Finding[] = [];

  const counterparts = (
    type: "image" | "page",
    english: Iterable<string>,
    translated: Iterable<string>
  ): void => {
    const theirs = new Set(translated);
    const ours = new Set(english);

    for (const entry of ours) {
      if (!theirs.has(entry)) {
        findings.push({
          file: path.posix.join(SOURCE, entry),
          message: `The ${type} has no counterpart at ${path.posix.join(root, entry)}. Every tree under \`${DOCS}/\` holds the pages and images \`${SOURCE}/\` holds, under the same names, and a change that adds one adds it to every tree.`,
        });
      }
    }

    for (const entry of theirs) {
      if (!ours.has(entry)) {
        findings.push({
          file: path.posix.join(root, entry),
          message: `The ${type} translates nothing: ${path.posix.join(SOURCE, entry)} does not exist. A translated tree holds what \`${SOURCE}/\` holds and nothing else, so one that is removed or renamed there is removed or renamed here too.`,
        });
      }
    }
  };

  counterparts("page", source.pages.keys(), translation.pages.keys());
  counterparts("image", source.images, translation.images);

  for (const [entry, translated] of translation.pages) {
    const english = source.pages.get(entry);

    if (!english) {
      continue;
    }

    const file = path.posix.join(root, entry);
    const { revision } = english;

    if (
      revision !== null &&
      translated.revision !== null &&
      translated.revision !== revision
    ) {
      findings.push({
        file,
        line: 1,
        message:
          translated.revision < revision
            ? `The translation follows the English page as of ${translated.revision}, and ${path.posix.join(SOURCE, entry)} has changed since: it was updated on ${revision}. Bring the translation in line with it and set \`${SOURCE_UPDATED}\` to ${revision}.`
            : `\`${SOURCE_UPDATED}\` is ${translated.revision}, later than ${revision}, the \`updated\` date of ${path.posix.join(SOURCE, entry)} (its \`published\` date while it has none), which is the date it records.`,
      });
    }

    const sameRedirects =
      english.redirects.length === translated.redirects.length &&
      english.redirects.every((redirect) =>
        translated.redirects.includes(redirect)
      );

    if (!sameRedirects) {
      findings.push({
        file,
        line: 1,
        message: `\`redirect_from\` is not the one ${path.posix.join(SOURCE, entry)} has. A translation is published at the URL its English page is, so it redirects from the same former URLs.`,
      });
    }
  }

  return findings;
};

const run = promisify(execFile);

/**
 * The Markdown outside the locales' `trees` whose links are checked: every `README.md` and
 * `AGENTS.md`, `CONTRIBUTING.md`, and the skills under `skills/`, tracked or
 * about to be. The skills vendored under `.agents/skills/` are someone else's
 * to fix, and `.claude/skills/` only links to the ones under `skills/`.
 */
const listMarkdown = async (
  repository: string,
  trees: readonly string[]
): Promise<string[]> => {
  const { stdout } = await run(
    "git",
    [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      ":(glob)**/README.md",
      ":(glob)**/AGENTS.md",
      "CONTRIBUTING.md",
      ":(glob)skills/**/*.md",
      ":(exclude).agents",
      ":(exclude,glob)**/node_modules/**",
      ...trees.map((tree) => `:(exclude)${tree}`),
    ],
    { cwd: repository, maxBuffer: 16 * 1024 * 1024 }
  );

  const files = [...new Set(stdout.split("\0").filter(Boolean))];

  // A file deleted from the working tree is still in the index until the
  // deletion is staged, and has no links left to check.
  const present = await Promise.all(
    files.map((file) => exists(path.join(repository, file)))
  );

  return files.filter((_, index) => present[index]);
};

/**
 * Why a link in Markdown outside the documentation leads nowhere, or `null`.
 *
 * GitHub renders those files where they are, so a relative link is resolved
 * from the file's directory, a `/`-rooted one from the repository, and a bare
 * fragment in the file itself. A URL with a scheme is followed only when it
 * names `main` in this repository; every other host is out of reach.
 */
const checkMarkdownLink = async (
  context: Context,
  file: string,
  { image, line, url }: Link
): Promise<Finding | null> => {
  let destination = mainDestination(url);

  if (!destination) {
    if (url === "" || SCHEME.test(url) || url.startsWith("//")) {
      return null;
    }

    const { fragment, path: target } = splitUrl(url);
    let resolved = file;

    if (target.startsWith("/")) {
      resolved = path.posix.normalize(target.slice(1) || ".");
    } else if (target !== "") {
      resolved = path.posix.join(path.posix.dirname(file), target);
    }

    destination = { fragment, target: resolved.replace(/(?<=.)\/$/u, "") };
  }

  const message = await checkDestination(
    context,
    url,
    image ? { ...destination, fragment: null } : destination
  );

  return message === null ? null : { file, line, message };
};

/** The findings for the links in one Markdown file outside the documentation. */
const checkMarkdown = async (
  context: Context,
  file: string
): Promise<Finding[]> => {
  const source = await readFile(path.join(context.repository, file), "utf-8");

  const findings = await Promise.all(
    collectLinks(parseMarkdown(source)).map((link) =>
      checkMarkdownLink(context, file, link)
    )
  );

  return findings.filter((finding) => finding !== null);
};

const QUOTE_START = /^(?<indent>[\t ]*)# quoted by (?<page>\S+)$/u;
const QUOTE_END = /^[\t ]*# end of quote$/u;

/** Lines of a script that a page shows as one of its code blocks. */
export interface Quote {
  /** The line of the `# quoted by` comment. */
  line: number;
  page: string;
  /** The lines between the two comments, without the first one's indentation. */
  text: string;
}

/**
 * Every quote in a script, and a finding for a `# quoted by` comment that no
 * `# end of quote` closes before the next one or the end of the file.
 */
export interface CollectedQuotes {
  findings: Finding[];
  quotes: Quote[];
}

export const collectQuotes = (
  file: string,
  source: string
): CollectedQuotes => {
  const findings: Finding[] = [];
  const quotes: Quote[] = [];

  let open: {
    indent: string;
    line: number;
    lines: string[];
    page: string;
  } | null = null;

  const unclosed = (line: number): Finding => ({
    file,
    line,
    message: "This `# quoted by` comment has no `# end of quote` after it.",
  });

  for (const [index, text] of source.split(/\r?\n/u).entries()) {
    const start = QUOTE_START.exec(text);

    if (start?.groups) {
      if (open) {
        findings.push(unclosed(open.line));
      }

      open = {
        indent: start.groups.indent ?? "",
        line: index + 1,
        lines: [],
        page: start.groups.page ?? "",
      };
    } else if (open && QUOTE_END.test(text)) {
      quotes.push({
        line: open.line,
        page: open.page,
        text: open.lines.join("\n"),
      });
      open = null;
    } else if (open) {
      open.lines.push(
        text.startsWith(open.indent) ? text.slice(open.indent.length) : text
      );
    }
  }

  if (open) {
    findings.push(unclosed(open.line));
  }

  return { findings, quotes };
};

/**
 * Every shell script in the repository, tracked or about to be, that holds a
 * quote.
 */
const listQuotingScripts = async (repository: string): Promise<string[]> => {
  const { stdout } = await run(
    "git",
    [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      ":(glob)**/*.sh",
      ":(exclude,glob)**/node_modules/**",
    ],
    { cwd: repository, maxBuffer: 16 * 1024 * 1024 }
  );

  const files = [...new Set(stdout.split("\0").filter(Boolean))];

  const sources = await Promise.all(
    files.map((file) =>
      // A file deleted from the working tree is still in the index until the
      // deletion is staged, and quotes nothing.
      readFile(path.join(repository, file), "utf-8").catch(() => "")
    )
  );

  return files.filter((_, index) => sources[index]?.includes("# quoted by "));
};

/**
 * The findings for the quotes in the scripts under `repository`. A script runs
 * the lines it quotes, in CI, so the page it names has to be a page under
 * `root` with a code block that reads the same: a block that drifted from them
 * shows the reader commands nothing ran.
 */
const checkQuotes = async (
  repository: string,
  root: string
): Promise<Finding[]> => {
  const blocks = new Map<string, Promise<Set<string> | null>>();

  const codeBlocks = (page: string): Promise<Set<string> | null> => {
    let found = blocks.get(page);

    if (!found) {
      found = readFile(path.join(repository, page), "utf-8").then(
        (source) => {
          const values = new Set<string>();
          visit(parseMarkdown(source), (node) => {
            if (node.type === "code") {
              values.add(node.value);
            }
          });

          return values;
        },
        () => null
      );
      blocks.set(page, found);
    }

    return found;
  };

  const checkQuote = async (
    file: string,
    { line, page, text }: Quote
  ): Promise<Finding | null> => {
    const values =
      page.startsWith(`${root}/`) && page.endsWith(PAGE_EXTENSION)
        ? await codeBlocks(page)
        : null;

    if (values === null) {
      return {
        file,
        line,
        message: `\`${page}\` is not a page under \`${root}/\`.`,
      };
    }

    if (!values.has(text)) {
      return {
        file,
        line,
        message: `\`${page}\` has no code block that reads the same as the lines quoted from here; change the two together.`,
      };
    }

    return null;
  };

  const scripts = await listQuotingScripts(repository);

  const inScripts = await Promise.all(
    scripts.map(async (file) => {
      const source = await readFile(path.join(repository, file), "utf-8");
      const { findings, quotes } = collectQuotes(file, source);

      const checked = await Promise.all(
        quotes.map((quote) => checkQuote(file, quote))
      );

      return [...findings, ...checked.filter((finding) => finding !== null)];
    })
  );

  return inScripts.flat();
};

/**
 * Every finding in each locale's tree under `docs/`, every way a translated
 * tree is out of step with `docs/en/`, every quote a script holds that its
 * page does not show, and every link that leads nowhere from the Markdown
 * {@link listMarkdown} names, relative to `repository`, as are the files the
 * findings name, in the order of those files and lines.
 */
export const scan = async (repository = process.cwd()): Promise<Finding[]> => {
  const context = createContext(repository);
  const { findings: locales, trees } = await listTrees(repository);

  const checked = await Promise.all(
    trees.map((root) => checkTree(context, root))
  );

  const source = checked[trees.indexOf(SOURCE)];

  const translations = source
    ? trees.flatMap((root, index) => {
        const translation = checked[index];

        return root === SOURCE || !translation
          ? []
          : compareTrees(source, root, translation);
      })
    : [];

  const markdown = await listMarkdown(repository, trees);

  const inMarkdown = await Promise.all(
    markdown.map((file) => checkMarkdown(context, file))
  );

  const quotes = await checkQuotes(repository, SOURCE);

  return [
    ...locales,
    ...checked.flatMap((tree) => tree.findings),
    ...translations,
    ...quotes,
    ...inMarkdown.flat(),
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

  console.log(
    `${DOCS}: every page follows the contract in docs/README.md, every translation is in step with ${SOURCE}/, and every link in the repository's Markdown resolves.`
  );
};

/**
 * The unit test imports {@link checkPage} and {@link scan} rather than running
 * the check, so it only starts when this file is the program.
 */
if (process.argv[1] === import.meta.filename) {
  await main();
}
