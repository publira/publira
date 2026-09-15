import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { SEED_TENANT } from "../src/scenarios/multi-tenant";
import { hostPath } from "../src/urls";

/** The width most of a tenant's readers arrive at, as the screenshots record it. */
const PHONE_VIEWPORT = { height: 844, width: 390 };

/** The other width the screenshots record, where the band draws the whole row. */
const DESKTOP_VIEWPORT = { height: 900, width: 1280 };

interface HeaderControl {
  height: number;
  label: string;
  width: number;
  x: number;
  y: number;
}

const overlaps = (one: HeaderControl, other: HeaderControl): boolean =>
  one.x < other.x + other.width &&
  other.x < one.x + one.width &&
  one.y < other.y + other.height &&
  other.y < one.y + one.height;

/**
 * Every control the band is drawing, as the reader's own rectangles.
 *
 * `checkVisibility()` rather than a `:visible` selector, so a control the band
 * hides at this width is left out for the same reason the browser leaves it
 * out, and what remains is what a finger can reach.
 */
const headerControls = (page: Page): Promise<HeaderControl[]> =>
  page.getByRole("banner").evaluate((header) =>
    [...header.querySelectorAll("a, button, input")]
      .filter((element) => element.checkVisibility())
      .map((element) => {
        const rect = element.getBoundingClientRect();

        return {
          height: rect.height,
          label:
            element.getAttribute("aria-label") ??
            element.textContent?.trim() ??
            element.tagName,
          width: rect.width,
          x: rect.x,
          y: rect.y,
        };
      })
  );

const collisions = (controls: HeaderControl[]): string[] => {
  const found: string[] = [];

  for (const [index, control] of controls.entries()) {
    for (const other of controls.slice(index + 1)) {
      if (overlaps(control, other)) {
        found.push(`${control.label} / ${other.label}`);
      }
    }
  }

  return found;
};

/**
 * The site header at a phone width.
 *
 * The band is one row of 36px controls and 342px wide between its margins,
 * which is not enough for the catalog field, the language, and both account
 * actions beside the tenant's name. They are behind the menu button instead,
 * and these tests hold both halves of that: nothing in the row lands on
 * anything else, and everything the row stopped drawing is still reachable.
 */
test.describe("web-host header at a phone width", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(PHONE_VIEWPORT);
  });

  test("draws no two controls on top of each other", async ({ page }) => {
    await page.goto(hostPath("/series"));

    await expect(
      page.getByRole("heading", { level: 1, name: "Series" })
    ).toBeVisible();
    // The menu button is the last thing the band resolves, so the row is
    // settled once it is there.
    await expect(
      page.getByRole("button", { name: "Open navigation" })
    ).toBeVisible();

    expect(collisions(await headerControls(page))).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(PHONE_VIEWPORT.width);
  });

  test("reaches the catalog field, the language, and both account actions through the menu", async ({
    page,
  }) => {
    await page.goto(hostPath("/series"));

    await expect(
      page.getByRole("heading", { level: 1, name: "Series" })
    ).toBeVisible();
    await page.getByRole("button", { name: "Open navigation" }).click();

    // The band still holds the wide-width copies of these controls, hidden, so
    // every assertion names the drawer's own.
    const menu = page.getByRole("dialog", { name: "Menu" });
    const links = menu.getByRole("navigation");

    // The rows are the two ways in that stay useful as the catalog grows. A
    // flat list of every author and a flat list of every series are not among
    // them, so the drawer offers neither as a destination.
    await expect(links.getByRole("link")).toHaveText(["Labels", "Genres"]);
    await expect(
      menu.getByRole("searchbox", { name: "Search works" })
    ).toBeVisible();
    // One door to the results rather than two: the field is the drawer's
    // search, so the rows beside it do not repeat it as a destination.
    await expect(menu.getByRole("search")).toHaveCount(1);
    await expect(links.getByRole("link", { name: "Search" })).toHaveCount(0);
    await expect(menu.getByRole("link", { name: "English" })).toHaveAttribute(
      "aria-current",
      "true"
    );
    await expect(menu.getByRole("link", { name: "Sign in" })).toBeVisible();
    await expect(menu.getByRole("link", { name: "Get started" })).toBeVisible();
  });

  test("closes the menu on the way to the page it was asked for", async ({
    page,
  }) => {
    await page.goto(hostPath("/series"));

    await expect(
      page.getByRole("heading", { level: 1, name: "Series" })
    ).toBeVisible();
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page
      .getByRole("dialog", { name: "Menu" })
      .getByRole("link", { name: "Labels" })
      .click();

    await expect(
      page.getByRole("heading", { level: 1, name: "Labels" })
    ).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Menu" })).toBeHidden();
  });
});

/**
 * The site header at a desktop width, where the band draws the whole row.
 *
 * The row names the ways in that stay useful as the catalog grows — the labels,
 * the genres, and the field — and nothing that grows into a wall of names with
 * it. The field is the one way into the results: a link beside it would be a
 * second door to the same room, and the page behind that door opens by asking
 * for the keyword the field already takes.
 */
test.describe("web-host header at a desktop width", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
  });

  test("starts a search from the field, the only entry the band draws", async ({
    page,
  }) => {
    await page.goto(hostPath("/series"));

    await expect(
      page.getByRole("heading", { level: 1, name: "Series" })
    ).toBeVisible();

    const banner = page.getByRole("banner");
    // The navigation is the last row the band resolves, so it is settled once
    // its own labels are there.
    const nav = banner.getByRole("navigation");
    await expect(nav.getByRole("link", { name: "Genres" })).toBeVisible();

    await expect(banner.getByRole("search")).toHaveCount(1);
    await expect(nav.getByRole("link", { name: "Search" })).toHaveCount(0);

    // The keyword is typed and submitted from the field itself, so the results
    // are reachable without a pointer ever landing on the submit button.
    const field = banner.getByRole("searchbox", { name: "Search works" });
    await field.fill(SEED_TENANT.series.title);
    await expect(field).toBeFocused();
    await field.press("Enter");

    await expect(page).toHaveURL(/\/search\?q=/u);
    expect(new URL(page.url()).searchParams.get("q")).toBe(
      SEED_TENANT.series.title
    );
    // The page the field lands on is the overview of all three result groups,
    // so the narrowing `/search` offers is still one submission away from the
    // band that no longer links to it.
    await expect(
      page.getByRole("heading", { level: 1, name: "Search" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Series" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Authors" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Labels" })
    ).toBeVisible();
  });

  test("links to the labels and the genres, and to neither flat list", async ({
    page,
  }) => {
    await page.goto(hostPath(`/series/${SEED_TENANT.series.publicId}`));

    const nav = page.getByRole("banner").getByRole("navigation");
    await expect(nav.getByRole("link")).toHaveText(["Labels", "Genres"]);

    // The two lists the band stopped naming are still there, and the work a
    // reader is looking at is one of the ways back to them.
    await page.getByRole("link", { name: "Back to the series list" }).click();

    await expect(
      page.getByRole("heading", { level: 1, name: "Series" })
    ).toBeVisible();
  });
});
