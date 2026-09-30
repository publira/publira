import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { signInAsSeedPlatformSuperAdmin } from "../src/platform";
import { WEB_PLATFORM_BASE_URL } from "../src/urls";

const markFile = (name: string): Promise<Buffer> =>
  readFile(new URL(`../../packages/brand/logo-mark/${name}`, import.meta.url));

/**
 * The bytes a `<link>` of the current document points at, after checking they
 * are served as a PNG.
 */
const linkedImage = async (page: Page, selector: string): Promise<Buffer> => {
  const href = await page.locator(selector).getAttribute("href");
  expect(href).not.toBeNull();
  const response = await page.request.get(
    new URL(href ?? "", page.url()).toString()
  );
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/png");
  return await response.body();
};

/**
 * The console declares the Publira mark as its favicon and apple icon, and
 * serves the very bytes `@publira/brand` exports rather than a copy of them.
 */
test.describe("web-platform brand icons", () => {
  test("the sign-in screen links the mark as its favicon and apple icon", async ({
    page,
  }) => {
    await page.goto(`${WEB_PLATFORM_BASE_URL}/login`);

    expect(
      await linkedImage(page, 'link[rel="icon"][sizes="32x32"]')
    ).toStrictEqual(await markFile("icon-32.png"));
    expect(
      await linkedImage(page, 'link[rel="icon"][sizes="192x192"]')
    ).toStrictEqual(await markFile("icon-192.png"));
    expect(
      await linkedImage(page, 'link[rel="apple-touch-icon"]')
    ).toStrictEqual(await markFile("apple-icon-180.png"));
  });

  test("the not-found document, which skips the root layout, links them too", async ({
    page,
  }) => {
    // Signed in, because the proxy sends a visitor without a session from any
    // unknown path to the sign-in screen before the not-found document renders.
    await signInAsSeedPlatformSuperAdmin(page, "/");
    const response = await page.goto(`${WEB_PLATFORM_BASE_URL}/no-such-page`);
    expect(response?.status()).toBe(404);

    expect(
      await linkedImage(page, 'link[rel="icon"][sizes="32x32"]')
    ).toStrictEqual(await markFile("icon-32.png"));
    expect(
      await linkedImage(page, 'link[rel="apple-touch-icon"]')
    ).toStrictEqual(await markFile("apple-icon-180.png"));
  });
});
