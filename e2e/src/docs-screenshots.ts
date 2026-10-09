import { readdirSync, readFileSync } from "node:fs";
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

/**
 * The message catalogs the consoles render their copy from, one per locale,
 * read once each.
 */
const LOCALES_ROOT = path.resolve(import.meta.dirname, "../../locales");
const catalogs = new Map<string, unknown>();

/** The message at `key` in `locales/<locale>.json`, as the catalog spells it. */
const catalogMessage = (locale: string, key: string): string => {
  let catalog = catalogs.get(locale);
  if (catalog === undefined) {
    catalog = JSON.parse(
      readFileSync(path.join(LOCALES_ROOT, `${locale}.json`), "utf-8")
    ) as unknown;
    catalogs.set(locale, catalog);
  }
  let message: unknown = catalog;
  for (const part of key.split(".")) {
    message =
      typeof message === "object" && message !== null
        ? (message as Record<string, unknown>)[part]
        : undefined;
  }
  if (typeof message !== "string") {
    throw new TypeError(`locales/${locale}.json has no message at ${key}.`);
  }
  return message;
};

/**
 * The text the consoles show for `key` in `locale`, from `locales/<locale>.json`.
 *
 * A shot finds the region it takes by the copy on screen, and that copy is in
 * the language of the tree the image goes in: a spec naming an English
 * heading would find nothing on the screen `docs/ja/` is photographed from. So
 * a spec names the catalog key the console renders the heading from, and the
 * same spec photographs every locale. Only plain text is returned; a message
 * with a placeholder is refused, since the text on screen depends on a value
 * the spec does not know. {@link docsTextPattern} matches one of those.
 */
export const docsText = (locale: string, key: string): string => {
  const message = catalogMessage(locale, key);
  if (/(?<!\\)[{}]/u.test(message)) {
    throw new Error(
      `${key} in locales/${locale}.json takes a value, so its text on screen is not known.`
    );
  }
  return message.replaceAll(/\\(?<escaped>[\\{}|])/gu, "$<escaped>");
};

/** `text` as a pattern that matches it and nothing else. */
const escapeRegExp = (text: string): string =>
  text.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/**
 * The text the consoles show for `key` in `locale`, as a pattern that matches
 * whatever value fills each of its placeholders: `Account menu for {$name}`
 * matches the account menu of whoever is signed in.
 *
 * A message that chooses between variants (`.match`) is refused, since which
 * variant is on screen depends on the value, and so is one that escapes a
 * character, which no message a spec looks for does.
 */
export const docsTextPattern = (locale: string, key: string): RegExp => {
  const message = catalogMessage(locale, key);
  if (message.startsWith(".") || message.includes("\\")) {
    throw new Error(
      `${key} in locales/${locale}.json chooses between variants or escapes a character, which no pattern here follows.`
    );
  }
  const parts = message.split(/\{[^{}]*\}/u);
  return new RegExp(`^${parts.map(escapeRegExp).join(".+")}$`, "u");
};

/**
 * The section of a console screen headed by `heading`, a level-2 heading: a
 * settings card, a form section, a list with its title.
 *
 * The consoles draw each of these as a `<section>` with no name of its own,
 * so it is found by the heading inside it. Sections nest, and an outer one
 * contains the heading as well, so the innermost is the one taken: in
 * document order a section comes after the sections around it.
 */
export const docsSection = (page: Page, heading: string): Locator =>
  page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { exact: true, level: 2, name: heading }),
    })
    .last();

/**
 * Everything a console screen shows below the console's own bar and beside
 * its sidebar, for a screen short enough to be taken whole.
 */
export const docsScreen = (page: Page): Locator =>
  page.getByRole("main").locator("section").first();

/**
 * The top of a console screen: its title, and the buttons beside it that
 * create something or lead elsewhere.
 */
export const docsScreenHeader = (page: Page): Locator =>
  page.getByRole("main").locator("header").first();

/**
 * The row of a console form that holds `control`: its label, the control,
 * and the hints under it.
 *
 * A row is a direct child of the form's fieldset, which is the one thing the
 * rows of every form have in common; the row itself carries no name.
 */
export const docsField = (control: Locator): Locator =>
  control.locator("xpath=ancestor-or-self::*[parent::fieldset][1]");

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
  /**
   * The region the passage explains: a form, a list row, a dialog. A pair
   * takes the run of the screen from the first element's top to the second's
   * bottom, for a passage about several fields of a long form that no one
   * element holds by themselves.
   */
  element: Locator | readonly [Locator, Locator];
  /** The tree the image goes in, one of {@link DOCS_LOCALES}. */
  locale: string;
  /**
   * What the screen draws anew every time it is opened, such as a secret
   * generated for this visit, covered over so the image can match twice.
   */
  mask?: readonly Locator[];
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

/** What a masked part of a screen is painted over with. */
const MASK_COLOR = "#d4d4d4";

/** Room left around a region, so its edges do not touch the image's. */
const REGION_MARGIN = 16;

/**
 * Where on the page `element` is, in CSS pixels from the document's top left,
 * with {@link REGION_MARGIN} around it.
 *
 * The margin stays inside the screen's `<main>` when the region is in it, so
 * a region at the top or the left edge of the content does not take a strip
 * of the console's bar or sidebar with it. A dialog is outside `<main>`, and
 * keeps its margin of the dimmed screen behind it.
 */
const regionOf = async (
  element: DocsShot["element"]
): Promise<{ height: number; width: number; x: number; y: number }> => {
  const ends: readonly Locator[] = Array.isArray(element)
    ? element
    : [element as Locator];
  const boxes = await Promise.all(
    ends.map(async (locator) => {
      await expect(locator).toBeVisible();
      return locator.evaluate((node) => {
        const box = node.getBoundingClientRect();
        const main = node.closest("main")?.getBoundingClientRect();
        return {
          bounds: main
            ? {
                bottom: main.bottom + window.scrollY,
                left: main.left + window.scrollX,
                right: main.right + window.scrollX,
                top: main.top + window.scrollY,
              }
            : {
                bottom: document.documentElement.scrollHeight,
                left: 0,
                right: document.documentElement.scrollWidth,
                top: 0,
              },
          box: {
            bottom: box.bottom + window.scrollY,
            left: box.left + window.scrollX,
            right: box.right + window.scrollX,
            top: box.top + window.scrollY,
          },
        };
      });
    })
  );
  const left = Math.max(
    ...boxes.map(({ bounds }) => bounds.left),
    Math.min(...boxes.map(({ box }) => box.left)) - REGION_MARGIN
  );
  const top = Math.max(
    ...boxes.map(({ bounds }) => bounds.top),
    Math.min(...boxes.map(({ box }) => box.top)) - REGION_MARGIN
  );
  const right = Math.min(
    ...boxes.map(({ bounds }) => bounds.right),
    Math.max(...boxes.map(({ box }) => box.right)) + REGION_MARGIN
  );
  const bottom = Math.min(
    ...boxes.map(({ bounds }) => bounds.bottom),
    Math.max(...boxes.map(({ box }) => box.bottom)) + REGION_MARGIN
  );
  return { height: bottom - top, width: right - left, x: left, y: top };
};

/**
 * Compare one region of a screen with the image beside the documentation page
 * that shows it, or write that image under `--update-snapshots`.
 *
 * The region rather than the page: a passage explains one form or one list,
 * and a full-page shot of a long console form is mostly not that, and loses
 * the console's navigation off the top of the viewport besides. The region is
 * cut out of the whole page rather than taken as the element, so it keeps a
 * margin of the screen around it, and a region taller than the viewport is
 * taken whole. What the shot waits for is {@link waitForScreenToSettle}'s, and
 * it is taken at the project's device scale factor, so the text in it stays
 * sharp once the website scales the image to its content column.
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
  // From the top: the console's bar is sticky, and a full-page shot of a page
  // a test scrolled, by filling in a field down the form, draws the bar where
  // the viewport was, across the middle of the region.
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  // The region is measured before the shot, and a dialog that is still
  // scaling in measures smaller than the one Playwright then photographs with
  // its animations stopped at their end.
  await page.evaluate(async () => {
    const finishing: Promise<Animation>[] = [];
    for (const animation of document.getAnimations()) {
      if (
        animation.effect?.getComputedTiming().endTime !==
        Number.POSITIVE_INFINITY
      ) {
        finishing.push(animation.finished);
      }
    }
    // A canceled animation rejects, and is as finished as one that ran out.
    await Promise.allSettled(finishing);
  });

  await expect(page).toHaveScreenshot(name, {
    clip: await regionOf(shot.element),
    fullPage: true,
    mask: shot.mask ? [...shot.mask] : undefined,
    // A neutral grey reads as "left out" in the documentation, where
    // Playwright's magenta would read as part of the screen.
    maskColor: MASK_COLOR,
    scale: "device",
  });
};
