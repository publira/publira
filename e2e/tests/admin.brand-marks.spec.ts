import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { signInAsSeedAdmin } from "../src/admin";
import {
  brandMarkForm,
  expectBrandMarkStatus,
  uploadPlaceholderMark,
} from "../src/brand-marks";
import { seedSeriesPublicId } from "../src/scenarios/reading-signals";
import { serverActionAnswered } from "../src/server-action";
import { storefrontPath, WEB_STOREFRONT_BASE_URL } from "../src/urls";

/** An all-ages series of the seed tenant, whose page carries the share menu. */
const SERIES_URL = `${WEB_STOREFRONT_BASE_URL}${storefrontPath(
  `/series/${seedSeriesPublicId(90)}`
)}`;

/** The console's form for the X mark. */
const xMarkForm = (page: Page): Locator => brandMarkForm(page, "x_share");

const xMarkDeleteButton = (page: Page): Locator =>
  xMarkForm(page).getByRole("button", { exact: true, name: "Delete" });

const deleteXMark = async (page: Page): Promise<void> => {
  const form = xMarkForm(page);
  await expect(xMarkDeleteButton(page)).toBeVisible({ timeout: 30_000 });
  await xMarkDeleteButton(page).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  const answered = serverActionAnswered(page);
  await dialog.getByRole("button", { exact: true, name: "Delete" }).click();
  await answered;
  await expectBrandMarkStatus(form, "The mark was deleted.");
};

/**
 * Deletes the X mark when the tenant has one. `isVisible` does not wait, so
 * the form is waited for first: a Delete asked for before the screen has
 * drawn would be read as no mark at all.
 */
const deleteXMarkIfSet = async (page: Page): Promise<void> => {
  await expect(xMarkForm(page)).toBeVisible({ timeout: 30_000 });

  if (!(await xMarkDeleteButton(page).isVisible())) {
    return;
  }

  await deleteXMark(page);
};

/**
 * The share menu's X row on the storefront, with the menu opened as a browser
 * without the Web Share API opens it: the system sheet would hide the rows.
 */
const openXShareRow = async (page: Page): Promise<Locator> => {
  await page.goto(SERIES_URL);
  await page.getByRole("button", { name: /^Share “/u }).click();
  const row = page.getByRole("link", { exact: true, name: "Share on X" });
  await expect(row).toBeVisible();

  return row;
};

/**
 * Whether the X row draws a loaded image at its head. `naturalWidth` is what
 * tells a delivered image from a slot whose request failed.
 */
const xRowDrawsMark = async (page: Page): Promise<boolean> => {
  const row = await openXShareRow(page);

  return await row.evaluate((link) => {
    const image = link.querySelector("img");

    return image !== null && image.complete && image.naturalWidth > 0;
  });
};

/** Whether the X row is its label and nothing else, as it is with no mark. */
const xRowIsLabelAlone = async (page: Page): Promise<boolean> => {
  const row = await openXShareRow(page);

  return await row.evaluate(
    (link) => link.childElementCount === 0 && link.textContent === "Share on X"
  );
};

/**
 * A brand mark uploaded on the console's Branding screen reaching the
 * storefront: the X mark heads the share menu's X row once it is uploaded,
 * and the row is its label alone again once it is deleted. The suite leaves
 * the seed tenant with no X mark either way.
 */
test.describe("admin brand marks", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "share", {
        configurable: true,
        value: undefined,
      });
    });
    await signInAsSeedAdmin(page, "/branding");
    await deleteXMarkIfSet(page);
  });

  test.afterEach(async ({ page }) => {
    await signInAsSeedAdmin(page, "/branding");
    await deleteXMarkIfSet(page);
  });

  test("an uploaded X mark heads the share menu's X row, and deleting it leaves the label alone", async ({
    page,
  }) => {
    await uploadPlaceholderMark(page, "x_share");

    await expect
      .poll(async () => await xRowDrawsMark(page), {
        message: `${SERIES_URL} never drew the uploaded X mark`,
        timeout: 30_000,
      })
      .toBe(true);

    await signInAsSeedAdmin(page, "/branding");
    await deleteXMark(page);

    await expect
      .poll(async () => await xRowIsLabelAlone(page), {
        message: `${SERIES_URL} kept the deleted X mark`,
        timeout: 30_000,
      })
      .toBe(true);
  });
});
