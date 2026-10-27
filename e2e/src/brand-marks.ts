import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";

import { serverActionAnswered } from "./server-action";

/** The kinds of third-party mark the console's Branding screen uploads. */
export type BrandMarkKind =
  | "app_store_badge"
  | "apple_sign_in"
  | "google_play_badge"
  | "google_sign_in"
  | "line_share"
  | "x_share";

/** The console's form for one kind of mark, named by the kind it posts. */
export const brandMarkForm = (page: Page, kind: BrandMarkKind): Locator =>
  page.locator(`form#tenant-brand-mark-${kind}`);

/** The status line a mark's form shows once a write lands. */
export const expectBrandMarkStatus = (
  form: Locator,
  text: string
): Promise<void> =>
  expect(form.getByRole("status").filter({ hasText: text })).toBeVisible({
    timeout: 60_000,
  });

/**
 * A placeholder drawn for the test, so that no third party's mark is ever part
 * of the suite: diagonal stripes on a 96×96 PNG.
 */
const drawPlaceholderMark = async (page: Page): Promise<Buffer> => {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 96;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("no 2d context");
    }
    context.fillStyle = "#f4f4f5";
    context.fillRect(0, 0, 96, 96);
    context.strokeStyle = "#7c3aed";
    context.lineWidth = 8;
    for (let offset = -96; offset < 96; offset += 24) {
      context.beginPath();
      context.moveTo(offset, 96);
      context.lineTo(offset + 96, 0);
      context.stroke();
    }
    return canvas.toDataURL("image/png");
  });

  return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
};

/**
 * Uploads a placeholder as the `kind` mark from the Branding screen the page
 * is on, accepting the owner's guidelines as the dialog asks.
 */
export const uploadPlaceholderMark = async (
  page: Page,
  kind: BrandMarkKind
): Promise<void> => {
  const form = brandMarkForm(page, kind);
  await form.getByRole("button", { exact: true, name: "Upload" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("checkbox", {
      name: "I have read these guidelines and accept them.",
    })
    .check();
  await dialog.locator('input[name="image"]').setInputFiles({
    buffer: await drawPlaceholderMark(page),
    mimeType: "image/png",
    name: "placeholder-mark.png",
  });
  const uploaded = serverActionAnswered(page);
  await dialog.getByRole("button", { name: "Upload the mark" }).click();
  await uploaded;
  await expectBrandMarkStatus(form, "The mark was uploaded.");
};
