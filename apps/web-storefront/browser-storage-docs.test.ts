import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const APP_DIR = import.meta.dirname;

/**
 * The page a tenant writes their privacy policy from. Its list of cookies and
 * browser storage is the only place a tenant can learn what the site leaves in
 * a reader's browser, so every name this app sets has to be on it.
 */
const PAGES_DOC = path.join(
  APP_DIR,
  "../../docs/en/4-console/3-setup/3-pages.md"
);

const SECTION_HEADING = "### What the site stores in a reader's browser";

/**
 * Cookies this app writes whose name a shared package defines, so the scan of
 * this app's source below cannot see them: the proxy publishes the resolved
 * locale through `@publira/utils/resolved-locale`.
 */
const SHARED_COOKIE_NAMES = ["publira_resolved_locale"];

const COOKIE_NAME_PATTERN = /profileCookieName\(\s*"(?<name>[^"]+)"/gu;

/**
 * `localStorage` and `sessionStorage` keys are named `publira.<what>`. A key
 * built per tenant is matched up to its variable part, which the page writes
 * as a placeholder.
 */
const STORAGE_KEY_PATTERN = /["'`](?<name>publira\.[a-z0-9.-]+)/gu;

const SKIPPED_DIRECTORIES = new Set([".next", "node_modules"]);

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      return SKIPPED_DIRECTORIES.has(entry.name) ? [] : sourceFiles(entryPath);
    }

    return /\.tsx?$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name)
      ? [entryPath]
      : [];
  });

const collect = (pattern: RegExp): string[] => {
  const names = new Set<string>();

  for (const file of sourceFiles(APP_DIR)) {
    for (const match of readFileSync(file, "utf-8").matchAll(pattern)) {
      if (match.groups?.name) {
        names.add(match.groups.name);
      }
    }
  }

  return [...names].toSorted();
};

const documentedSection = (): string => {
  const page = readFileSync(PAGES_DOC, "utf-8");
  const start = page.indexOf(SECTION_HEADING);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = page.indexOf("\n#", start + SECTION_HEADING.length);

  return end === -1 ? page.slice(start) : page.slice(start, end);
};

describe("the browser storage a tenant's privacy policy is written from", () => {
  it("names every cookie the storefront sets", () => {
    const cookieNames = [
      ...collect(COOKIE_NAME_PATTERN),
      ...SHARED_COOKIE_NAMES,
    ];

    expect(cookieNames).toContain("publira_web_storefront_auth");

    const section = documentedSection();

    const missing = cookieNames.filter(
      (name) => !section.includes(`\`${name}\``)
    );

    expect(missing).toEqual([]);
  });

  it("names every localStorage and sessionStorage key the storefront writes", () => {
    const storageKeys = collect(STORAGE_KEY_PATTERN);
    expect(storageKeys).toContain("publira.age-rating.confirmation.");

    const section = documentedSection();
    const missing = storageKeys.filter((key) => !section.includes(`\`${key}`));
    expect(missing).toEqual([]);
  });
});
