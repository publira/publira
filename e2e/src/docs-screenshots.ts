import { readdirSync } from "node:fs";
import path from "node:path";

import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";

import { waitForScreenToSettle } from "./screenshots";

/**
 * The user documentation, one tree per locale (`docs/en/`), whose pages show
 * the screenshots the `docs-screenshots` project takes. `docs/README.md` is
 * the contract the tree follows.
 */
export const DOCS_ROOT = path.resolve(import.meta.dirname, "../../docs");

/**
 * Every locale the documentation has a tree for, which is every locale the
 * shots are taken in.
 *
 * Read from the tree rather than listed, so a translation that adds
 * `docs/ja/` gets its screenshots from the same specs: a shot in that tree has
 * to show the console in that language, and nothing else decides which
 * languages those are.
 */
export const DOCS_LOCALES: readonly string[] = readdirSync(DOCS_ROOT, {
  withFileTypes: true,
})
  .flatMap((entry) => (entry.isDirectory() ? [entry.name] : []))
  .toSorted();

/** What `scripts/check-docs.ts` accepts after a page's slug. */
const SUBJECT = /^[a-z\d]+(?:-[a-z\d]+)*$/u;

/** A numbered entry, `<n>-<slug>` or `<n>-<slug>.md`, as `docs/README.md` names them. */
const ENTRY_NAME = /^[1-9]\d*-(?<slug>[a-z\d]+(?:-[a-z\d]+)*)(?<page>\.md)?$/u;

/**
 * Show the console at `baseUrl` in `locale` from the next request on.
 *
 * The consoles keep the reader's language in the `publira_locale` cookie, the
 * one their language menu writes, so a shot needs no click through that menu.
 * Set it after signing in: the sign-in helpers find the form by its English
 * copy.
 */
export const setDocsLocale = async (
  page: Page,
  baseUrl: string,
  locale: string
): Promise<void> => {
  await page
    .context()
    .addCookies([{ name: "publira_locale", url: baseUrl, value: locale }]);
};

export interface DocsShot {
  /** The region the passage explains: a form, a list row, a dialog. */
  element: Locator;
  /** The tree the image goes in, one of {@link DOCS_LOCALES}. */
  locale: string;
  /**
   * The page that shows the image, by the path the website publishes it at
   * under `/docs/<version>/`: `console` for `4-console/index.md`,
   * `console/catalog/episodes` for `4-console/1-catalog/2-episodes.md`.
   */
  page: string;
  /** What the image shows, as lowercase words joined by `-`. */
  subject: string;
}

/**
 * The image's path under `docs/`, as path segments: beside its page, named
 * `<page slug>-<subject>.png`, and `index-<subject>.png` for an `index.md`.
 *
 * The page is found by its slugs rather than named by its numbered path, the
 * way the website finds it: `docs/README.md` makes renumbering routine, and a
 * pull request that renumbers pages alone changes no file the E2E run is
 * started for, so a spec naming the old number would fail in the next pull
 * request that does. The number is left out of the image's name for the same
 * reason; the slug keeps the images of sibling pages apart.
 */
const docsImagePath = ({ locale, page, subject }: DocsShot): string[] => {
  if (!SUBJECT.test(subject)) {
    throw new Error(
      `"${subject}" is not a subject: lowercase ASCII words joined by "-".`
    );
  }

  const segments = page.split("/");
  const directories: string[] = [];
  for (const [index, segment] of segments.entries()) {
    // Only the last segment can be a page of its own; any other is a directory.
    const last = index === segments.length - 1;
    const entry = readdirSync(path.join(DOCS_ROOT, locale, ...directories), {
      withFileTypes: true,
    }).find((candidate) => {
      const name = ENTRY_NAME.exec(candidate.name)?.groups;
      return (
        name?.slug === segment &&
        (name.page === undefined
          ? candidate.isDirectory()
          : last && candidate.isFile())
      );
    });
    if (!entry) {
      throw new Error(
        `docs/${locale}/ has no page at ${page}. A shot is named after the page that shows it.`
      );
    }
    if (entry.isFile()) {
      return [locale, ...directories, `${segment}-${subject}.png`];
    }
    directories.push(entry.name);
  }

  return [locale, ...directories, `index-${subject}.png`];
};

/**
 * Compare one region of a screen with the image beside the documentation page
 * that shows it, or write that image under `--update-snapshots`.
 *
 * The region rather than the page: a passage explains one form or one list,
 * and a full-page shot of a long console form is mostly not that, and loses
 * the console's navigation off the top of the viewport besides. What the shot
 * waits for is {@link waitForScreenToSettle}'s, and it is taken at the
 * project's device scale factor, so the text in it stays sharp once the
 * website scales the image to its content column.
 *
 * The screen has to be in the locale of the tree the image goes in, so the
 * document's language is checked before the shot.
 */
export const expectDocsScreenshot = async (
  page: Page,
  shot: DocsShot
): Promise<void> => {
  const name = docsImagePath(shot);

  await expect(page.locator("html")).toHaveAttribute("lang", shot.locale);
  await waitForScreenToSettle(page);

  await expect(shot.element).toHaveScreenshot(name, { scale: "device" });
};
