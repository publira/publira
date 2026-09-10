import { expect, test } from "@playwright/test";

import { freezeClock } from "../src/clock";
import { MISSING_PUBLIC_ID, SEED_TENANT } from "../src/scenarios/multi-tenant";
import { RANKING_ENTRY_COUNT } from "../src/scenarios/ranking";
import {
  VIEWER_EPISODE_PATH,
  viewerPageLabel,
} from "../src/scenarios/viewer-pages";
import { expectScreenshot, SCREENSHOT_VIEWPORTS } from "../src/screenshots";
import { hostPath } from "../src/urls";

/**
 * What the public site looks like, at a phone width and a desktop width.
 *
 * These record the screens rather than assert anything about them: a change to
 * one arrives as an image next to the image it replaces, instead of as a
 * description of it. The assertions before each shot are only there to be sure
 * the page finished arriving — every section streams in behind Suspense, and a
 * skeleton photographs as readily as the content that replaces it.
 *
 * The dates on these screens come from
 * `db/seeds/scenarios/160_screenshot_baseline.sql`, which pins what the
 * development seed dates from the moment it ran.
 */

/**
 * The moment the browser believes it is while the top page is recorded.
 *
 * That page words a publication date as how long ago it was, and it does so in
 * the browser against its own clock, so the phrase moves on without the page
 * changing. `freezeClock` pins it.
 *
 * Three days after the last date `160_screenshot_baseline.sql` writes
 * (2026-04-17): late enough that every episode reads as published in the past,
 * and close enough that the rows show the day-scale wording the design is
 * about rather than a column of identical months.
 */
const SCREENSHOT_CLOCK = "2026-04-20T00:00:00.000Z";

/**
 * What the newest row says under {@link SCREENSHOT_CLOCK}.
 *
 * Asserted before the shot because the clock has one way of going quiet: it is
 * pinned in two places, `Date` and `Temporal.Now`, and which of them the phrase
 * comes from is the browser's choice. A page that slipped back to the real
 * clock would still photograph cleanly, and the baseline would then drift with
 * the calendar until some unrelated pull request failed on it.
 */
const NEWEST_ROW_RELATIVE_TIME = "3 days ago";

/**
 * The streamed sections of the top page, each with a link it only holds once
 * its read has come back.
 *
 * Every one of them has a `Suspense` boundary of its own and they resolve in
 * whatever order their reads return, so the shot waits for all five by name.
 * Waiting for the last one on the page would only say that one arrived.
 */
const TOP_PAGE_SECTIONS = [
  { href: "/series/", name: "New episodes" },
  { href: "/series/", name: "Top 10 this week" },
  { href: "/series/", name: "Recently updated" },
  { href: "/labels/", name: "Featured labels" },
  { href: "/authors/", name: "Featured authors" },
] as const;

test.describe("web-host screenshots", () => {
  for (const viewport of SCREENSHOT_VIEWPORTS) {
    test.describe(`at ${viewport.label}px`, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize(viewport);
      });

      test("the catalog top page", async ({ page }) => {
        await freezeClock(page, SCREENSHOT_CLOCK);
        await page.goto(hostPath("/"));

        // The featured work is the page's own heading.
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await Promise.all(
          TOP_PAGE_SECTIONS.map(({ href, name }) =>
            expect(
              page
                .getByRole("region", { name })
                .locator(`a[href^="${hostPath(href)}"]`)
                .first()
            ).toBeVisible()
          )
        );
        await expect(
          page.getByText(NEWEST_ROW_RELATIVE_TIME).first()
        ).toBeVisible();

        await expectScreenshot(page, viewport, "top-page");
      });

      test("the series list", async ({ page }) => {
        await page.goto(hostPath("/series"));

        await expect(
          page.getByRole("heading", { level: 1, name: "Series" })
        ).toBeVisible();
        await expect(
          page.getByRole("navigation", { name: "Series list pagination" })
        ).toBeVisible();

        await expectScreenshot(page, viewport, "series-list");
      });

      /**
       * The daily chart, which is what `/ranking` shows without a period in
       * the URL. Its positions and its computed time come from
       * `db/seeds/scenarios/170_ranking.sql`, which `task e2e:db` applies, so
       * the page draws the same chart on every run.
       */
      test("the ranking page", async ({ page }) => {
        await page.goto(hostPath("/ranking"));

        await expect(
          page.getByRole("heading", { exact: true, level: 1, name: "Ranking" })
        ).toBeVisible();
        await expect(page.locator("main ol > li")).toHaveCount(
          RANKING_ENTRY_COUNT
        );

        await expectScreenshot(page, viewport, "ranking");
      });

      test("the label list", async ({ page }) => {
        await page.goto(hostPath("/labels"));

        await expect(
          page.getByRole("heading", { level: 1, name: "Labels" })
        ).toBeVisible();
        await expect(
          page.getByRole("navigation", { name: "Label list pagination" })
        ).toBeVisible();

        await expectScreenshot(page, viewport, "label-list");
      });

      test("the author list", async ({ page }) => {
        await page.goto(hostPath("/authors"));

        await expect(
          page.getByRole("heading", { level: 1, name: "Authors" })
        ).toBeVisible();
        await expect(
          page.getByRole("navigation", { name: "Author list pagination" })
        ).toBeVisible();

        await expectScreenshot(page, viewport, "author-list");
      });

      test("a series detail page", async ({ page }) => {
        await page.goto(hostPath(`/series/${SEED_TENANT.series.publicId}`));

        await expect(
          page.getByRole("heading", {
            level: 1,
            name: SEED_TENANT.series.title,
          })
        ).toBeVisible();
        await expect(
          page.getByRole("heading", { level: 2, name: "Episodes" })
        ).toBeVisible();

        await expectScreenshot(page, viewport, "series-detail");
      });

      test("a label detail page", async ({ page }) => {
        await page.goto(hostPath(`/labels/${SEED_TENANT.labelId}`));

        await expect(
          page.getByRole("heading", {
            level: 1,
            name: SEED_TENANT.labelName,
          })
        ).toBeVisible();
        await expect(
          page.getByRole("navigation", { name: "Label series pagination" })
        ).toBeVisible();

        await expectScreenshot(page, viewport, "label-detail");
      });

      test("an author detail page", async ({ page }) => {
        await page.goto(hostPath(`/authors/${SEED_TENANT.authorId}`));

        await expect(
          page.getByRole("heading", {
            level: 1,
            name: SEED_TENANT.authorName,
          })
        ).toBeVisible();
        await expect(
          page.getByRole("navigation", { name: "Related series pagination" })
        ).toBeVisible();

        await expectScreenshot(page, viewport, "author-detail");
      });

      test("an episode with a comic body", async ({ page }) => {
        await page.goto(hostPath(VIEWER_EPISODE_PATH));

        // The canvas reports the page it has drawn, so the shot waits for
        // pixels rather than for the element that will hold them.
        await expect(
          page.locator(`canvas[aria-label="${viewerPageLabel(1)}"]`)
        ).toHaveAttribute("data-page-status", "loaded");

        await expectScreenshot(page, viewport, "episode-comic");
      });

      // An episode carries images and nothing else today, so the second body
      // this records is the notice a reader gets when it carries none. The
      // novel text viewer the redesign will also have to cover is #445, and
      // this suite grows a screen for it when that one lands.
      test("an episode with no body", async ({ page }) => {
        await page.goto(
          hostPath(
            `/series/${SEED_TENANT.series.publicId}/episodes/${SEED_TENANT.series.freeEpisodeId}`
          )
        );

        await expect(
          page.getByRole("heading", {
            level: 1,
            name: SEED_TENANT.series.freeEpisodeTitle,
          })
        ).toBeVisible();
        await expect(
          page.getByRole("link", { name: "Go to the series" })
        ).toBeVisible();

        await expectScreenshot(page, viewport, "episode-without-body");
      });

      test("search results", async ({ page }) => {
        // A prefix every seeded series, creator, and label carries, so the shot
        // is of all three groups answering one keyword. Each group's link into
        // its own view is the last thing it renders, so waiting for the three
        // of them is waiting for the whole screen.
        await page.goto(hostPath("/search?q=Seed"));

        await expect(
          page.getByRole("heading", { level: 1, name: "Search" })
        ).toBeVisible();
        await expect(
          page.getByRole("link", { name: "Show all series" })
        ).toBeVisible();
        await expect(
          page.getByRole("link", { name: "Show all authors" })
        ).toBeVisible();
        await expect(
          page.getByRole("link", { name: "Show all labels" })
        ).toBeVisible();

        await expectScreenshot(page, viewport, "search-results");
      });

      test("the sign-in screen", async ({ page }) => {
        await page.goto(hostPath("/login"));

        await expect(page.getByLabel(/Email address/u)).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Sign in" })
        ).toBeVisible();

        await expectScreenshot(page, viewport, "login");
      });

      test("the not-found screen", async ({ page }) => {
        await page.goto(hostPath(`/series/${MISSING_PUBLIC_ID}`));

        await expect(
          page.getByRole("heading", { level: 1, name: "Page not found" })
        ).toBeVisible();

        await expectScreenshot(page, viewport, "not-found");
      });
    });
  }
});
