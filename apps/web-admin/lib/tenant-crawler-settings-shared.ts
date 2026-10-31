/**
 * The rule a path the tenant's robots.txt excludes is held to, as the Go
 * server writes it in `server/internal/crawlersettings`. The settings card
 * checks each field once the operator leaves it and the Server Action checks
 * the list again before it is sent, so an operator is told which path is wrong
 * without a round trip. The server stays the authority, and a refusal from it
 * is still worded by the card.
 *
 * Kept apart from `tenant-crawler-settings.ts` because the settings card is a
 * Client Component: importing from the module that reads the session would
 * pull `next/headers` into the browser graph.
 */

import type { AdminClientMessageAccessor } from "./messages";

/** What a crawler fetches pages for, as the card groups the checklist by. */
export const CRAWLER_PURPOSES = [
  "ai_training",
  "ai_assistant",
  "image_search",
  "other",
] as const;

export type CrawlerPurpose = (typeof CRAWLER_PURPOSES)[number];

/** A crawler the tenant may exclude, as the server lists it. */
export interface KnownCrawler {
  /** The token robots.txt names it by, which is also what is stored. */
  userAgent: string;
  /** The organization that runs it, as it names itself. */
  operator: string;
  /**
   * `other` for a purpose this console does not know yet, so a crawler the
   * server added later is still offered, and a save does not drop it.
   */
  purpose: CrawlerPurpose;
}

/** The longest list the server accepts, after duplicates are dropped. */
export const MAX_CRAWLER_EXCLUDED_PATHS = 100;

/** The longest path, in UTF-8 bytes, the server accepts. */
const MAX_PATH_BYTES = 512;

/** What robots.txt and the sitemap index are served at. */
const RESERVED_PATHS = new Set(["/robots.txt", "/sitemap.xml"]);

/** The directory the sitemap index points into. */
const RESERVED_PREFIX = "/sitemap";

/**
 * What would end the rule early or turn the path into a pattern: whitespace
 * and control characters end a robots.txt line's value, # starts a comment,
 * * and $ are wildcards, and ? starts a query. `White_Space` and `Cc` are the
 * sets Go's `unicode.IsSpace` and `unicode.IsControl` test.
 */
const FORBIDDEN = /[\p{White_Space}\p{Cc}*$?#]/u;

const SPACE = /^\p{White_Space}$/u;

/**
 * Go's `strings.TrimSpace`. JavaScript's own `trim` also strips U+FEFF, which
 * Go's does not, so the spaces are trimmed by the same set the forbidden
 * characters are tested against. Every such space is a single UTF-16 unit.
 */
const trimSpace = (value: string): string => {
  let start = 0;
  let end = value.length;

  while (start < end && SPACE.test(value.charAt(start))) {
    start += 1;
  }

  while (end > start && SPACE.test(value.charAt(end - 1))) {
    end -= 1;
  }

  return value.slice(start, end);
};

const utf8Length = (value: string): number =>
  new TextEncoder().encode(value).length;

/** Why the server would refuse a path. */
export type CrawlerPathRefusal = "invalid" | "reserved" | "too_long";

type CrawlerPathResult =
  | { ok: true; path: string }
  | { ok: false; reason: CrawlerPathRefusal };

/**
 * `crawlersettings.normalizePath`: the path trimmed, without a trailing /
 * unless it is / itself, or why the server would refuse it.
 */
const normalizeCrawlerPath = (value: string): CrawlerPathResult => {
  let path = trimSpace(value);

  while (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, -1);
  }

  if (!path.startsWith("/") || FORBIDDEN.test(path)) {
    return { ok: false, reason: "invalid" };
  }

  if (utf8Length(path) > MAX_PATH_BYTES) {
    return { ok: false, reason: "too_long" };
  }

  if (
    RESERVED_PATHS.has(path) ||
    path === RESERVED_PREFIX ||
    path.startsWith(`${RESERVED_PREFIX}/`)
  ) {
    return { ok: false, reason: "reserved" };
  }

  return { ok: true, path };
};

export type CrawlerPathsResult =
  | {
      ok: true;
      /** The non-blank paths, trimmed, for the server to normalize. */
      paths: string[];
    }
  | { ok: false; reason: CrawlerPathRefusal; path: string }
  | { ok: false; reason: "too_many" };

/** The paths as the server would take them; blank ones are dropped. */
export const parseCrawlerPaths = (
  values: readonly string[]
): CrawlerPathsResult => {
  const paths: string[] = [];
  const normalized = new Set<string>();

  for (const value of values) {
    const path = trimSpace(value);

    if (path === "") {
      continue;
    }

    const result = normalizeCrawlerPath(path);

    if (!result.ok) {
      return { ok: false, path, reason: result.reason };
    }

    paths.push(path);
    normalized.add(result.path);
  }

  // Counted after duplicates are dropped, as the server counts.
  if (normalized.size > MAX_CRAWLER_EXCLUDED_PATHS) {
    return { ok: false, reason: "too_many" };
  }

  return { ok: true, paths };
};

/** What the card and the Action say about a path the server would refuse. */
export const crawlerPathMessage = (
  t: AdminClientMessageAccessor,
  { path, reason }: { path: string; reason: CrawlerPathRefusal }
): string => {
  switch (reason) {
    case "reserved": {
      return t("admin.settings.crawlers.validation.path_reserved", { path });
    }

    case "too_long": {
      return t("admin.settings.crawlers.validation.path_too_long", {
        max: MAX_PATH_BYTES,
        path,
      });
    }

    default: {
      return t("admin.settings.crawlers.validation.path_invalid", { path });
    }
  }
};
