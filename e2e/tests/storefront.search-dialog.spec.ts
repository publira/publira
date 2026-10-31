import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { storefrontPath } from "../src/urls";

/** The width most of a tenant's readers arrive at, as the screenshots record it. */
const PHONE_VIEWPORT = { height: 844, width: 390 };

/** The other width the screenshots record, where the band draws the whole row. */
const DESKTOP_VIEWPORT = { height: 900, width: 1280 };

/** A keyword every seeded series title answers to. */
const KEYWORD = "Seed";

/**
 * Whether the element that holds focus draws something to say so: a ring,
 * which the design writes as a box shadow, or the browser's own outline.
 */
const focusIsVisible = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const element = document.activeElement;

    if (!element || element === document.body) {
      return false;
    }

    const style = getComputedStyle(element);

    return style.boxShadow !== "none" || style.outlineStyle !== "none";
  });

/**
 * Press Tab unless `control` is where the walk starts, and expect focus to land
 * on it with its focus state drawn.
 */
const tabTo = async (
  page: Page,
  control: Locator,
  { first }: { first: boolean }
): Promise<void> => {
  if (!first) {
    await page.keyboard.press("Tab");
  }

  await expect(control).toBeFocused();
  expect(
    await focusIsVisible(page),
    `${await control.getAttribute("name")} draws no focus state`
  ).toBe(true);
};

/**
 * Walk the dialog with Tab from the keyword field and expect focus to land on
 * every control in it, in the order a reader meets them, each drawing its
 * focus state.
 */
const expectEveryControlReachable = async (
  page: Page,
  dialog: Locator
): Promise<void> => {
  const controls = [
    dialog.getByRole("searchbox", { name: "Search works" }),
    dialog.getByRole("button", { exact: true, name: "Search" }),
    dialog.getByRole("combobox", { name: "Genre" }),
    dialog.getByRole("combobox", { name: "Sort" }),
    dialog.getByRole("combobox", { name: "Status" }),
    dialog.getByRole("checkbox", { name: "Only series with free episodes" }),
    // Focus stays in the dialog: past the last field it comes round to the
    // close button at the top.
    dialog.getByRole("button", { name: "Close search" }),
  ];

  for (const [index, control] of controls.entries()) {
    // oxlint-disable-next-line no-await-in-loop -- each Tab moves on from where the one before it left focus
    await tabTo(page, control, { first: index === 0 });
  }
};

/**
 * The search dialog the band and the drawer open: the keyword with the series
 * list's sort and filters beside it, submitted as a plain `GET` to `/search`.
 */
test.describe("web-storefront search dialog at a desktop width", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
  });

  test("opens, is walked, and is dismissed from the keyboard", async ({
    page,
  }) => {
    await page.goto(storefrontPath("/series"));
    await expect(
      page.getByRole("heading", { level: 1, name: "Series" })
    ).toBeVisible();

    const trigger = page
      .getByRole("banner")
      .getByRole("button", { name: "Search works" });

    await trigger.focus();
    expect(await focusIsVisible(page)).toBe(true);
    await trigger.press("Enter");

    const dialog = page.getByRole("dialog", { name: "Search" });
    await expect(dialog).toBeVisible();
    await expectEveryControlReachable(page, dialog);

    await page.keyboard.press("Escape");

    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("narrows the search to the series group and writes the series list's keys", async ({
    page,
  }) => {
    await page.goto(storefrontPath("/series"));
    await expect(
      page.getByRole("heading", { level: 1, name: "Series" })
    ).toBeVisible();

    const trigger = page
      .getByRole("banner")
      .getByRole("button", { name: "Search works" });

    await trigger.click();

    const dialog = page.getByRole("dialog", { name: "Search" });
    const field = dialog.getByRole("searchbox", { name: "Search works" });
    await expect(field).toBeFocused();
    await field.fill(KEYWORD);
    await dialog
      .getByRole("combobox", { name: "Status" })
      .selectOption("ongoing");
    await dialog.getByRole("combobox", { name: "Sort" }).selectOption("title");
    await field.press("Enter");

    await expect(page).toHaveURL(/\/search\?/u);
    const params = new URL(page.url()).searchParams;
    expect(params.get("q")).toBe(KEYWORD);
    expect(params.get("status")).toBe("ongoing");
    expect(params.get("order")).toBe("title");

    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    // Only the series have a serialization status, so a narrowed search
    // answers with that group alone.
    await expect(
      page.getByRole("heading", { level: 2, name: "Series" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Authors" })
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { level: 2, name: "Labels" })
    ).toHaveCount(0);
  });
});

test.describe("web-storefront search dialog at a phone width", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(PHONE_VIEWPORT);
  });

  test("opens from the drawer's row and gives focus back to it", async ({
    page,
  }) => {
    await page.goto(storefrontPath("/series"));
    await expect(
      page.getByRole("heading", { level: 1, name: "Series" })
    ).toBeVisible();
    await page.getByRole("button", { name: "Open navigation" }).click();

    const menu = page.getByRole("dialog", { name: "Menu" });
    const row = menu.getByRole("button", { name: "Search works" });
    await expect(row).toBeVisible();
    await row.focus();
    await row.press("Enter");

    const dialog = page.getByRole("dialog", { name: "Search" });
    await expect(dialog).toBeVisible();
    await expectEveryControlReachable(page, dialog);

    await page.keyboard.press("Escape");

    // Dismissing the search leaves the drawer it was opened from where it was.
    await expect(dialog).toBeHidden();
    await expect(menu).toBeVisible();
    await expect(row).toBeFocused();
  });

  test("closes the drawer behind it on the way to the results", async ({
    page,
  }) => {
    await page.goto(storefrontPath("/series"));
    await expect(
      page.getByRole("heading", { level: 1, name: "Series" })
    ).toBeVisible();
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page
      .getByRole("dialog", { name: "Menu" })
      .getByRole("button", { name: "Search works" })
      .click();

    const dialog = page.getByRole("dialog", { name: "Search" });
    await dialog.getByRole("searchbox", { name: "Search works" }).fill(KEYWORD);
    await dialog
      .getByRole("checkbox", { name: "Only series with free episodes" })
      .check();
    await dialog.getByRole("button", { exact: true, name: "Search" }).click();

    await expect(page).toHaveURL(/\/search\?/u);
    expect(new URL(page.url()).searchParams.get("free")).toBe("1");
    await expect(
      page.getByRole("heading", { level: 2, name: "Series" })
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

/**
 * The search screen itself, which carries the same controls as the dialog so
 * a reader already on the results narrows them without opening anything.
 */
test.describe("web-storefront search screen filters", () => {
  test("renders a narrowed URL on a cold load, with the controls set to it", async ({
    page,
  }) => {
    const response = await page.goto(
      storefrontPath(`/search?q=${KEYWORD}&status=ongoing&order=title`)
    );

    expect(response?.status()).toBe(200);

    const form = page.getByRole("main").getByRole("search");
    await expect(form.getByRole("searchbox")).toHaveValue(KEYWORD);
    await expect(form.getByRole("combobox", { name: "Status" })).toHaveValue(
      "ongoing"
    );
    await expect(form.getByRole("combobox", { name: "Sort" })).toHaveValue(
      "title"
    );

    const series = page.getByRole("region", { exact: true, name: "Series" });
    await expect(series.getByRole("link").first()).toBeVisible();
    await expect(
      page.getByRole("region", { exact: true, name: "Authors" })
    ).toHaveCount(0);

    // Every page of the narrowed result stays narrowed.
    const next = page
      .getByRole("navigation", { name: "Series result pagination" })
      .first()
      .getByRole("link", { name: "Next page" });

    await expect(next).toHaveAttribute("href", /status=ongoing/u);
    await expect(next).toHaveAttribute("href", /order=title/u);

    // The way back to the overview answers the keyword alone.
    await page.getByRole("link", { name: "Back to all results" }).click();
    await expect(page).toHaveURL(
      (url) =>
        url.pathname.endsWith("/search") && url.search === `?q=${KEYWORD}`
    );
    await expect(
      page.getByRole("region", { exact: true, name: "Authors" })
    ).toBeVisible();
  });

  test("re-narrows the results from the screen's own controls", async ({
    page,
  }) => {
    await page.goto(storefrontPath(`/search?q=${KEYWORD}`));

    const form = page.getByRole("main").getByRole("search");
    await expect(
      page.getByRole("region", { exact: true, name: "Authors" })
    ).toBeVisible();

    await form.getByRole("combobox", { name: "Status" }).selectOption("hiatus");
    await form.getByRole("button", { name: "Search" }).click();

    await expect(page).toHaveURL(/status=hiatus/u);
    await expect(
      page.getByRole("region", { exact: true, name: "Authors" })
    ).toHaveCount(0);
    await expect(
      page.getByRole("region", { exact: true, name: "Series" })
    ).toBeVisible();
  });
});
