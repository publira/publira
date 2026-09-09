import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { hostPath } from "../src/urls";

/** The width most of a tenant's readers arrive at, as the screenshots record it. */
const PHONE_VIEWPORT = { height: 844, width: 390 };

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
    const links = menu.getByRole("navigation", { name: "Site navigation" });

    await expect(links.getByRole("link", { name: "Series" })).toBeVisible();
    await expect(links.getByRole("link", { name: "Labels" })).toBeVisible();
    await expect(links.getByRole("link", { name: "Authors" })).toBeVisible();
    await expect(
      menu.getByRole("searchbox", { name: "Search works" })
    ).toBeVisible();
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
