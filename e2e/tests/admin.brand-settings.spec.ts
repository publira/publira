import { readFile } from "node:fs/promises";

import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { fillField, signInAsSeedAdmin } from "../src/admin";
import { applyScenarioSql } from "../src/db";
import { EYE_CATCH_ASPECT_FIXTURES } from "../src/scenarios/eye-catch";
import { MULTI_TENANT_SCENARIO } from "../src/scenarios/multi-tenant";
import { serverActionAnswered } from "../src/server-action";
import {
  storefrontPath,
  WEB_ADMIN_BASE_URL,
  WEB_STOREFRONT_BASE_URL,
  WEB_STOREFRONT_OTHER_TENANT_BASE_URL,
} from "../src/urls";

const adminUrl = (pathname: string): string =>
  `${WEB_ADMIN_BASE_URL}${pathname}`;

const storefrontUrl = (pathname: string): string =>
  `${WEB_STOREFRONT_BASE_URL}${storefrontPath(pathname)}`;

const otherStorefrontUrl = (pathname: string): string =>
  `${WEB_STOREFRONT_OTHER_TENANT_BASE_URL}${storefrontPath(pathname)}`;

/**
 * Default `--publira-color-primary`. Keep in sync with
 * `DEFAULT_TENANT_THEME_COLORS` in `@publira/utils/theme-css-variables`.
 */
const DEFAULT_PRIMARY_COLOR = "#2b4c8c";

/** A passing contrast pair against the default primary text color `#ffffff`. */
const SAVED_PRIMARY_COLOR = "#1d4ed8";

const SEED_TENANT_NAME = "Seed Tenant";
const SEED_TENANT_LOGO_ALT = `${SEED_TENANT_NAME} logo`;

const BRANDING_FIXTURE = EYE_CATCH_ASPECT_FIXTURES.square;

/**
 * 1200x1600, so its shorter side clears the 512px the sign-in image needs and
 * a stored portrait is told apart from the square the other slots take.
 */
const SIGN_IN_IMAGE_FIXTURE = EYE_CATCH_ASPECT_FIXTURES.portrait;

/** `BRANDING_IMAGE_MAX_BYTES` in `branding/_lib/actions.ts`. */
const BRANDING_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/** A JPEG comment segment's marker, and the most bytes one segment can span. */
const JPEG_COMMENT_MARKER = 0xff_fe;
const JPEG_SEGMENT_MAX_BYTES = 2 + 0xff_ff;
const JPEG_SEGMENT_MIN_BYTES = 4;

/**
 * {@link BRANDING_FIXTURE} grown to exactly {@link BRANDING_IMAGE_MAX_BYTES}
 * with comment segments after its start-of-image marker. A decoder skips a
 * comment, so the picture stays the fixture's own and only the upload grows,
 * to the size the console's request body limits have to leave room for.
 */
const largestBrandingImage = async (): Promise<{
  buffer: Buffer;
  mimeType: string;
  name: string;
}> => {
  const fixture = await readFile(BRANDING_FIXTURE);
  const segments: Buffer[] = [];
  let remaining = BRANDING_IMAGE_MAX_BYTES - fixture.length;
  while (remaining > 0) {
    // A segment's length counts itself and nothing before it, so a segment is
    // never shorter than its marker and length; the last one is kept at least
    // that long by taking the shortfall from the one before.
    let size = Math.min(remaining, JPEG_SEGMENT_MAX_BYTES);
    if (remaining - size > 0 && remaining - size < JPEG_SEGMENT_MIN_BYTES) {
      size -= JPEG_SEGMENT_MIN_BYTES;
    }
    const segment = Buffer.alloc(size);
    segment.writeUInt16BE(JPEG_COMMENT_MARKER, 0);
    segment.writeUInt16BE(size - 2, 2);
    segments.push(segment);
    remaining -= size;
  }
  const buffer = Buffer.concat([
    fixture.subarray(0, 2),
    ...segments,
    fixture.subarray(2),
  ]);
  expect(buffer).toHaveLength(BRANDING_IMAGE_MAX_BYTES);
  return { buffer, mimeType: "image/jpeg", name: "largest-branding-image.jpg" };
};

const THEME_CSS_PATH = "/theme.css";

const brandingForm = (page: Page, fileInputName: string): Locator =>
  page
    .locator("form")
    .filter({ has: page.locator(`input[name="${fileInputName}"]`) });

const primaryColorField = (page: Page): Locator =>
  page.locator('input[name="primary_color"]');

const primaryForegroundField = (page: Page): Locator =>
  page.locator('input[name="primary_foreground_color"]');

const sansFontFamilyField = (page: Page): Locator =>
  page.locator('input[name="sans_font_family"]');

const expectStatus = (
  scope: Page | Locator,
  text: string,
  timeout = 30_000
): Promise<void> =>
  expect(scope.getByRole("status").filter({ hasText: text })).toBeVisible({
    timeout,
  });

const openThemeSettings = async (page: Page): Promise<void> => {
  await page.goto(adminUrl("/branding"));
  await expect(primaryColorField(page)).toBeVisible({ timeout: 30_000 });
};

/**
 * `GET /theme.css` through the Node-side request fixture, with cache-busting
 * headers so the 30s `Cache-Control` is not what we are waiting on. The
 * `"use cache"` entry is a different store: revalidation marks it stale rather
 * than dropping it, so the caller still has to poll.
 */
const fetchThemeCss = async (
  request: APIRequestContext,
  origin = WEB_STOREFRONT_BASE_URL
): Promise<string> => {
  const url = new URL(THEME_CSS_PATH, `${origin}/`);
  url.searchParams.set("e2e", crypto.randomUUID());
  const response = await request.get(url.toString(), {
    headers: {
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });
  expect(response.status(), await response.text()).toBe(200);
  return await response.text();
};

const themePrimaryDeclaration = (css: string): string => {
  const match = css.match(/--publira-color-primary:[^;]+/u);
  expect(match, css).not.toBeNull();
  return match?.[0] ?? "";
};

const expectThemeCssToContain = async (
  request: APIRequestContext,
  snippet: string,
  origin = WEB_STOREFRONT_BASE_URL
): Promise<void> => {
  await expect
    .poll(async () => await fetchThemeCss(request, origin), {
      message: `${origin}${THEME_CSS_PATH} never contained ${snippet}`,
      timeout: 30_000,
    })
    .toContain(snippet);
};

const primaryCustomProperty = (page: Page): Promise<string> =>
  page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--publira-color-primary")
      .trim()
      .toLowerCase()
  );

const storefrontSansFontFamily = (page: Page): Promise<string> =>
  page.evaluate(() => getComputedStyle(document.body).fontFamily);

/**
 * `/theme.css` is served with `max-age=30`, so a browser that already fetched
 * the previous palette would keep painting it. The Node-side `request` fixture
 * sends `Cache-Control: no-cache`; the public page has to do the same.
 */
const disableThemeCssHttpCache = async (page: Page): Promise<void> => {
  await page.route("**/theme.css", async (route) => {
    const headers = {
      ...route.request().headers(),
      "cache-control": "no-cache",
      pragma: "no-cache",
    };
    await route.continue({ headers });
  });
};

/**
 * Read a web-storefront page again and again until it reports what the console
 * just saved. Same reason as `admin.catalog-masters.spec.ts`: revalidation
 * serves the stale entry once while the refresh runs behind it.
 *
 * `read` has to answer "not yet" rather than wait for what is missing: a read
 * that blocks spends the whole budget on one load, because `expect.poll` never
 * aborts its callback.
 */
const pollStorefrontPage = <T>(
  page: Page,
  url: string,
  read: () => Promise<T>
) =>
  expect.poll(
    async () => {
      await page.goto(url);
      return await read();
    },
    { message: `${url} never caught up with the console`, timeout: 30_000 }
  );

/**
 * A page that saved once already shows "The theme was saved.", so the status
 * alone would pass before this click's Action is answered, and the next
 * `page.goto` would cancel it.
 */
const saveTheme = async (page: Page): Promise<void> => {
  const saved = serverActionAnswered(page);
  await page.getByRole("button", { name: "Save the theme" }).click();
  await saved;
  await expectStatus(page, "The theme was saved.");
};

const fillPrimaryColor = async (page: Page, color: string): Promise<void> => {
  await fillField(primaryColorField(page), color);
};

const restorePrimaryColor = async (
  page: Page,
  request: APIRequestContext
): Promise<void> => {
  const css = await fetchThemeCss(request);
  const formValue = await primaryColorField(page).inputValue();
  if (
    css.includes(`--publira-color-primary:${DEFAULT_PRIMARY_COLOR}`) &&
    formValue.toLowerCase() === DEFAULT_PRIMARY_COLOR
  ) {
    return;
  }
  await fillPrimaryColor(page, DEFAULT_PRIMARY_COLOR);
  await saveTheme(page);
  await expectThemeCssToContain(
    request,
    `--publira-color-primary:${DEFAULT_PRIMARY_COLOR}`
  );
};

const restoreFontFamilies = async (page: Page): Promise<void> => {
  if (
    !(await page.locator('input[name="serif_font_family"]').inputValue()) &&
    !(await sansFontFamilyField(page).inputValue())
  ) {
    return;
  }
  await fillField(page.locator('input[name="serif_font_family"]'), "");
  await fillField(sansFontFamilyField(page), "");
  await saveTheme(page);
};

const DARK_PALETTE_UNSAVED = "No dark palette is saved.";

const openDarkTab = async (page: Page): Promise<void> => {
  await page.getByRole("tab", { name: "Dark" }).click();
  await expect(
    page.getByRole("button", { name: "Save the dark palette" })
  ).toBeVisible();
};

/**
 * The Dark tab's Delete, offered only while a dark palette is saved. The panel
 * scopes it: a brand mark another suite uploaded puts a Delete of its own on
 * the screen.
 */
const darkPaletteDeleteButton = (page: Page): Locator =>
  page
    .getByRole("tabpanel")
    .getByRole("button", { exact: true, name: "Delete" });

const deleteDarkPaletteIfSet = async (page: Page): Promise<void> => {
  await openDarkTab(page);
  const deleteButton = darkPaletteDeleteButton(page);
  if (await deleteButton.isVisible()) {
    await deleteButton.click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { exact: true, name: "Delete" }).click();
    await expectStatus(page, "The dark palette was deleted.");
  }
  await page.getByRole("tab", { name: "Light" }).click();
  await expect(primaryColorField(page)).toBeVisible();
};

const deleteBrandingIfSet = async (
  page: Page,
  fileInputName: string,
  confirmation: string
): Promise<void> => {
  const form = brandingForm(page, fileInputName);
  const deleteButton = form.getByRole("button", {
    exact: true,
    name: "Delete",
  });
  if (!(await deleteButton.isVisible())) {
    return;
  }
  await deleteButton.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { exact: true, name: "Delete" }).click();
  await expectStatus(form, confirmation, 60_000);
};

const uploadBranding = async (
  page: Page,
  fileInputName: string,
  submitName: string,
  confirmation: string,
  file: Parameters<Locator["setInputFiles"]>[0] = BRANDING_FIXTURE
): Promise<void> => {
  const form = brandingForm(page, fileInputName);
  await form.locator(`input[name="${fileInputName}"]`).setInputFiles(file);
  await form.getByRole("button", { name: submitName }).click();
  await expectStatus(form, confirmation, 60_000);
};

/**
 * `*.localhost` is a Host the browser resolves and Node's `request` fixture
 * may not, so the other tenant's stylesheet is read from the page that
 * already carries that Host.
 */
const fetchOtherTenantThemeCss = async (page: Page): Promise<string> => {
  await page.goto(otherStorefrontUrl("/"));
  return await page.evaluate(async () => {
    const response = await fetch("/theme.css", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`/theme.css ${response.status}`);
    }
    return response.text();
  });
};

const toStorefrontAssetUrl = (src: string): string =>
  new URL(src, WEB_STOREFRONT_BASE_URL).toString();

const expectDeliveredImage = async (
  request: APIRequestContext,
  src: string
): Promise<void> => {
  const response = await request.get(toStorefrontAssetUrl(src));
  expect(response.status(), src).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^image\//u);
};

const headerBrand = (page: Page): Locator =>
  page.locator("header").getByRole("link").first();

const headerLogo = (page: Page): Locator =>
  headerBrand(page).getByRole("img", { name: SEED_TENANT_LOGO_ALT });

/**
 * The preview the sign-in image card draws, and the path of the stored image
 * behind it. `next/image` asks the image server for a resized copy, so the
 * query string the loader adds is dropped.
 */
const signInImagePreview = (page: Page): Locator =>
  brandingForm(page, "sign_in_image").getByRole("img", {
    name: "Current sign-in image",
  });

const signInImagePreviewPath = (page: Page): Promise<string> =>
  signInImagePreview(page).evaluate(
    (image: HTMLImageElement) => new URL(image.src).pathname
  );

const iconLink = (page: Page): Locator => page.locator('link[rel="icon"]');

const appleTouchIconLink = (page: Page): Locator =>
  page.locator('link[rel="apple-touch-icon"]');

/**
 * The header's brand: the logo's path, or the site-name text when there is no
 * logo. The path comes from the `src` property because `next/image` rewrites
 * the attribute to an absolute URL once an image with an `onError` handler
 * mounts.
 */
const headerBrandMark = (page: Page): Promise<string> =>
  headerBrand(page).evaluate((brand) => {
    const logo = brand.querySelector("img");
    return logo ? new URL(logo.src).pathname : (brand.textContent ?? "").trim();
  });

/**
 * The `rel="icon"` this document declares, or an empty string when it declares
 * none. Metadata arrives after `load`, so the read waits for the title that
 * same pass writes rather than for the link itself.
 */
const declaredIconHref = async (page: Page): Promise<string> => {
  await page.locator("head title").waitFor({ state: "attached" });
  const link = iconLink(page);
  return (await link.count()) > 0
    ? ((await link.getAttribute("href")) ?? "")
    : "";
};

/**
 * Tenant brand settings reaching the public site: a colour saved on
 * `/branding` is what `GET /theme.css` serves and what the public
 * document paints, a logo or icon is what the public header and icon links
 * show, and none of that crosses the tenant boundary. The sign-in image is
 * followed as far as the console's own card, which is where it is read back.
 *
 * `packages/utils` covers generation and the contrast check in isolation;
 * this is the end-to-end counterpart. The suite writes the seed tenant's
 * brand and puts it back in `afterEach`, so a run against a long-lived stack
 * leaves the defaults in place.
 */
test.describe("admin brand settings", () => {
  test.describe.configure({ mode: "serial" });

  let restoreTheme = false;
  let restoreDarkTheme = false;
  let restoreLogo = false;
  let restoreIcon = false;
  let restoreSignInImage = false;

  test.beforeAll(() => {
    applyScenarioSql(MULTI_TENANT_SCENARIO);
  });

  test.beforeEach(async ({ page, request }) => {
    restoreTheme = false;
    restoreDarkTheme = false;
    restoreLogo = false;
    restoreIcon = false;
    restoreSignInImage = false;
    await signInAsSeedAdmin(page, "/branding");
    await expect(primaryColorField(page)).toBeVisible({ timeout: 30_000 });
    await deleteBrandingIfSet(page, "logo", "The logo was deleted.");
    await deleteBrandingIfSet(page, "icon", "The icon was deleted.");
    await deleteBrandingIfSet(
      page,
      "sign_in_image",
      "The sign-in image was deleted."
    );
    await restorePrimaryColor(page, request);
  });

  test.afterEach(async ({ page, request }) => {
    if (
      !(
        restoreTheme ||
        restoreDarkTheme ||
        restoreLogo ||
        restoreIcon ||
        restoreSignInImage
      )
    ) {
      return;
    }
    await signInAsSeedAdmin(page, "/branding");
    await expect(primaryColorField(page)).toBeVisible({ timeout: 30_000 });
    if (restoreLogo) {
      await deleteBrandingIfSet(page, "logo", "The logo was deleted.");
    }
    if (restoreIcon) {
      await deleteBrandingIfSet(page, "icon", "The icon was deleted.");
    }
    if (restoreSignInImage) {
      await deleteBrandingIfSet(
        page,
        "sign_in_image",
        "The sign-in image was deleted."
      );
    }
    if (restoreTheme) {
      await restorePrimaryColor(page, request);
      await restoreFontFamilies(page);
    }
    if (restoreDarkTheme) {
      await deleteDarkPaletteIfSet(page);
    }
  });

  test("saving a theme colour reaches GET /theme.css and the public site", async ({
    page,
    request,
  }) => {
    restoreTheme = true;
    await fillPrimaryColor(page, SAVED_PRIMARY_COLOR);
    await saveTheme(page);

    await expectThemeCssToContain(
      request,
      `--publira-color-primary:${SAVED_PRIMARY_COLOR}`
    );

    await disableThemeCssHttpCache(page);
    await pollStorefrontPage(page, storefrontUrl("/"), async () => {
      await expect(
        page.getByRole("heading", { exact: true, name: "New episodes" })
      ).toBeVisible({ timeout: 5000 });
      return await primaryCustomProperty(page);
    }).toBe(SAVED_PRIMARY_COLOR);
  });

  test("saving a font stack reaches GET /theme.css and the public site", async ({
    page,
    request,
  }) => {
    restoreTheme = true;
    await fillField(sansFontFamilyField(page), "Arial, sans-serif");
    await saveTheme(page);

    await expectThemeCssToContain(
      request,
      "--publira-font-sans:Arial, sans-serif"
    );

    await disableThemeCssHttpCache(page);
    await pollStorefrontPage(page, storefrontUrl("/"), async () => {
      await expect(
        page.getByRole("heading", { exact: true, name: "New episodes" })
      ).toBeVisible({ timeout: 5000 });
      return await storefrontSansFontFamily(page);
    }).toBe("Arial, sans-serif");
  });

  test("a colour that fails the contrast check is refused rather than saved", async ({
    page,
    request,
  }) => {
    const before = themePrimaryDeclaration(await fetchThemeCss(request));

    const primary = await primaryColorField(page).inputValue();
    await fillField(primaryForegroundField(page), primary);
    await page.getByRole("button", { name: "Save the theme" }).click();

    await expectStatus(
      page,
      "Check these color pairs so the text stays readable."
    );
    await expect(
      page.getByRole("status").filter({
        hasText:
          "The contrast ratio between Primary color and Primary text color must be at least 4.5:1 (currently 1.00:1).",
      })
    ).toHaveCount(2);

    expect(themePrimaryDeclaration(await fetchThemeCss(request))).toBe(before);
  });

  test("a dark palette derived from the light one is saved apart from it and can be deleted", async ({
    page,
  }) => {
    restoreDarkTheme = true;
    await deleteDarkPaletteIfSet(page);
    const lightBackground = await page
      .locator('input[name="background_color"]')
      .inputValue();

    await openDarkTab(page);
    await expect(page.getByText(DARK_PALETTE_UNSAVED)).toBeVisible();
    await fillField(page.locator('input[name="background_color"]'), "#ffffff");
    await page.getByRole("button", { name: "Derive from light" }).click();
    const darkBackground = await page
      .locator('input[name="background_color"]')
      .inputValue();
    expect(darkBackground).not.toBe("#ffffff");
    expect(darkBackground).not.toBe(lightBackground);

    const saved = serverActionAnswered(page);
    await page.getByRole("button", { name: "Save the dark palette" }).click();
    await saved;
    await expectStatus(page, "The dark palette was saved.");

    await openThemeSettings(page);
    await expect(page.locator('input[name="background_color"]')).toHaveValue(
      lightBackground
    );
    await openDarkTab(page);
    await expect(page.getByText(DARK_PALETTE_UNSAVED)).toHaveCount(0);
    await expect(page.locator('input[name="background_color"]')).toHaveValue(
      darkBackground
    );

    await darkPaletteDeleteButton(page).click();
    const dialog = page.getByRole("alertdialog");
    await dialog.getByRole("button", { exact: true, name: "Delete" }).click();
    await expectStatus(page, "The dark palette was deleted.");
    await expect(page.getByText(DARK_PALETTE_UNSAVED)).toBeVisible();

    await openThemeSettings(page);
    await openDarkTab(page);
    await expect(page.getByText(DARK_PALETTE_UNSAVED)).toBeVisible();
  });

  test("a theme change on one tenant does not affect another tenant's /theme.css", async ({
    page,
    request,
  }) => {
    restoreTheme = true;

    const otherBefore = await fetchOtherTenantThemeCss(page);
    expect(otherBefore).toContain(
      `--publira-color-primary:${DEFAULT_PRIMARY_COLOR}`
    );

    await openThemeSettings(page);
    await fillPrimaryColor(page, SAVED_PRIMARY_COLOR);
    await saveTheme(page);

    await expectThemeCssToContain(
      request,
      `--publira-color-primary:${SAVED_PRIMARY_COLOR}`
    );

    const otherAfter = await fetchOtherTenantThemeCss(page);
    expect(otherAfter).toContain(
      `--publira-color-primary:${DEFAULT_PRIMARY_COLOR}`
    );
    expect(otherAfter).not.toContain(
      `--publira-color-primary:${SAVED_PRIMARY_COLOR}`
    );
  });

  test("uploading a tenant logo reaches the public header and removing it falls back to the site name", async ({
    page,
    request,
  }) => {
    restoreLogo = true;
    await uploadBranding(page, "logo", "Save the logo", "The logo was saved.");

    await pollStorefrontPage(page, storefrontUrl("/"), () =>
      headerBrandMark(page)
    ).toMatch(/^\/images\/tenants\/[^/]+\/logo$/u);

    const logoSrc = await headerLogo(page).getAttribute("src");
    expect(logoSrc).toBeTruthy();
    await expectDeliveredImage(request, logoSrc ?? "");
    await expect
      .poll(() =>
        headerLogo(page).evaluate(
          (image: HTMLImageElement) => image.naturalWidth
        )
      )
      .toBeGreaterThan(0);

    await openThemeSettings(page);
    await deleteBrandingIfSet(page, "logo", "The logo was deleted.");
    restoreLogo = false;

    await pollStorefrontPage(page, storefrontUrl("/"), () =>
      headerBrandMark(page)
    ).toBe(SEED_TENANT_NAME);
    await expect(headerLogo(page)).toHaveCount(0);
  });

  test("uploading a tenant icon reaches the public icon links and a tenant with no icon declares neither", async ({
    page,
    request,
  }) => {
    await page.goto(otherStorefrontUrl("/"));
    expect(await declaredIconHref(page)).toBe("");
    await expect(appleTouchIconLink(page)).toHaveCount(0);

    restoreIcon = true;
    await openThemeSettings(page);
    await uploadBranding(page, "icon", "Save the icon", "The icon was saved.");

    await pollStorefrontPage(page, storefrontUrl("/"), () =>
      declaredIconHref(page)
    ).toMatch(/\/images\/tenants\/[^/]+\/icon(?:\?|$)/u);

    const iconHref = await iconLink(page).getAttribute("href");
    const appleHref = await appleTouchIconLink(page).getAttribute("href");
    expect(iconHref, "rel=icon").toMatch(
      /\/images\/tenants\/[^/]+\/icon(?:\?|$)/u
    );
    expect(appleHref, "rel=apple-touch-icon").toMatch(
      /\/images\/tenants\/[^/]+\/icon(?:\?|$)/u
    );
    expect(appleHref).toBe(iconHref);
    await expectDeliveredImage(request, iconHref ?? "");

    await openThemeSettings(page);
    await deleteBrandingIfSet(page, "icon", "The icon was deleted.");
    restoreIcon = false;

    await pollStorefrontPage(page, storefrontUrl("/"), () =>
      declaredIconHref(page)
    ).toBe("");
    await expect(appleTouchIconLink(page)).toHaveCount(0);
  });

  test("an uploaded sign-in image is what the Branding screen shows after a reload, and removing it empties the slot", async ({
    page,
    request,
  }) => {
    const form = brandingForm(page, "sign_in_image");
    await expect(form.getByText("No sign-in image is set.")).toBeVisible();

    restoreSignInImage = true;
    await uploadBranding(
      page,
      "sign_in_image",
      "Save the sign-in image",
      "The sign-in image was saved.",
      SIGN_IN_IMAGE_FIXTURE
    );

    await openThemeSettings(page);
    await expect(signInImagePreview(page)).toBeVisible();
    const storedPath = await signInImagePreviewPath(page);
    expect(storedPath).toMatch(/^\/images\/tenants\/[^/]+\/sign_in$/u);
    await expectDeliveredImage(request, storedPath);
    // The stored image keeps the upload's portrait shape rather than being
    // cropped to the square the icon is.
    await expect
      .poll(() =>
        signInImagePreview(page).evaluate(
          (image: HTMLImageElement) => image.naturalHeight > image.naturalWidth
        )
      )
      .toBe(true);

    await deleteBrandingIfSet(
      page,
      "sign_in_image",
      "The sign-in image was deleted."
    );
    restoreSignInImage = false;

    await openThemeSettings(page);
    await expect(signInImagePreview(page)).toHaveCount(0);
    await expect(
      brandingForm(page, "sign_in_image").getByText("No sign-in image is set.")
    ).toBeVisible();
  });

  test("a logo, an icon, and a sign-in image of the 10 MiB the console accepts are saved", async ({
    page,
  }) => {
    const image = await largestBrandingImage();

    restoreLogo = true;
    await uploadBranding(
      page,
      "logo",
      "Save the logo",
      "The logo was saved.",
      image
    );

    restoreIcon = true;
    await uploadBranding(
      page,
      "icon",
      "Save the icon",
      "The icon was saved.",
      image
    );

    restoreSignInImage = true;
    await uploadBranding(
      page,
      "sign_in_image",
      "Save the sign-in image",
      "The sign-in image was saved.",
      image
    );
  });
});
