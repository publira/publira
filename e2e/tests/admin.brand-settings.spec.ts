import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { fillField, signInAsSeedAdmin } from "../src/admin";
import { applyScenarioSql } from "../src/db";
import { EYE_CATCH_ASPECT_FIXTURES } from "../src/scenarios/eye-catch";
import { MULTI_TENANT_SCENARIO } from "../src/scenarios/multi-tenant";
import {
  hostPath,
  WEB_ADMIN_BASE_URL,
  WEB_HOST_BASE_URL,
  WEB_HOST_EDGE_BASE_URL,
  WEB_HOST_OTHER_TENANT_BASE_URL,
} from "../src/urls";

const adminUrl = (pathname: string): string =>
  `${WEB_ADMIN_BASE_URL}${pathname}`;

const hostUrl = (pathname: string): string =>
  `${WEB_HOST_BASE_URL}${hostPath(pathname)}`;

const otherHostUrl = (pathname: string): string =>
  `${WEB_HOST_OTHER_TENANT_BASE_URL}${hostPath(pathname)}`;

/**
 * A delivered logo or icon is `/images/tenants/{id}/{logo,icon}` on the
 * reader's origin, and only the Traefik edge joins web-host and image-server
 * under one host and port. The header's brand mark falls back to the site-name
 * text when that request fails, so those assertions run against the edge.
 */
const edgeUrl = (pathname: string): string =>
  `${WEB_HOST_EDGE_BASE_URL}${hostPath(pathname)}`;

/**
 * Default `--publira-color-primary`. Keep in sync with
 * `DEFAULT_TENANT_THEME_COLORS` in `@publira/utils/theme-css-variables`.
 */
const DEFAULT_PRIMARY_COLOR = "#0f7c82";

/** A passing contrast pair against the default primary text color `#f4fbfb`. */
const SAVED_PRIMARY_COLOR = "#1d4ed8";

const SEED_TENANT_NAME = "Seed Tenant";
const SEED_TENANT_LOGO_ALT = `${SEED_TENANT_NAME} logo`;

const BRANDING_FIXTURE = EYE_CATCH_ASPECT_FIXTURES.square;

const THEME_CSS_PATH = "/theme.css";

const brandingForm = (page: Page, fileInputName: string): Locator =>
  page
    .locator("form")
    .filter({ has: page.locator(`input[name="${fileInputName}"]`) });

const primaryColorField = (page: Page): Locator =>
  page.locator('input[name="primary_color"]');

const primaryForegroundField = (page: Page): Locator =>
  page.locator('input[name="primary_foreground_color"]');

const expectStatus = (
  scope: Page | Locator,
  text: string,
  timeout = 30_000
): Promise<void> =>
  expect(scope.getByRole("status").filter({ hasText: text })).toBeVisible({
    timeout,
  });

const openThemeSettings = async (page: Page): Promise<void> => {
  await page.goto(adminUrl("/settings/theme"));
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
  origin = WEB_HOST_BASE_URL
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

const expectThemeCssToContain = (
  request: APIRequestContext,
  snippet: string,
  origin = WEB_HOST_BASE_URL
): ReturnType<typeof expect.poll<string>> =>
  expect.poll(async () => await fetchThemeCss(request, origin), {
    message: `${origin}${THEME_CSS_PATH} never contained ${snippet}`,
    timeout: 30_000,
  });

const primaryCustomProperty = (page: Page): Promise<string> =>
  page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--publira-color-primary")
      .trim()
      .toLowerCase()
  );

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
 * Read a web-host page again and again until it reports what the console just
 * saved. Same reason as `admin.catalog-masters.spec.ts`: revalidation serves
 * the stale entry once while the refresh runs behind it.
 */
const pollHostPage = <T>(page: Page, url: string, read: () => Promise<T>) =>
  expect.poll(
    async () => {
      await page.goto(url);
      return await read();
    },
    { message: `${url} never caught up with the console`, timeout: 30_000 }
  );

const saveTheme = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: "Save the theme" }).click();
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
  confirmation: string
): Promise<void> => {
  const form = brandingForm(page, fileInputName);
  await form
    .locator(`input[name="${fileInputName}"]`)
    .setInputFiles(BRANDING_FIXTURE);
  await form.getByRole("button", { name: submitName }).click();
  await expectStatus(form, confirmation, 60_000);
};

/**
 * `*.localhost` is a Host the browser resolves and Node's `request` fixture
 * may not, so the other tenant's stylesheet is read from the page that
 * already carries that Host.
 */
const fetchOtherTenantThemeCss = async (page: Page): Promise<string> => {
  await page.goto(otherHostUrl("/"));
  return await page.evaluate(async () => {
    const response = await fetch("/theme.css", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`/theme.css ${response.status}`);
    }
    return response.text();
  });
};

const toEdgeAssetUrl = (src: string): string =>
  new URL(src, WEB_HOST_EDGE_BASE_URL).toString();

const expectDeliveredImage = async (
  request: APIRequestContext,
  src: string
): Promise<void> => {
  const response = await request.get(toEdgeAssetUrl(src));
  expect(response.status(), src).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^image\//u);
};

const headerBrand = (page: Page): Locator =>
  page.locator("header").getByRole("link").first();

const headerLogo = (page: Page): Locator =>
  headerBrand(page).getByRole("img", { name: SEED_TENANT_LOGO_ALT });

const iconLink = (page: Page): Locator => page.locator('link[rel="icon"]');

const appleTouchIconLink = (page: Page): Locator =>
  page.locator('link[rel="apple-touch-icon"]');

/**
 * Tenant brand settings reaching the public site: a colour saved on
 * `/settings/theme` is what `GET /theme.css` serves and what the public
 * document paints, a logo or icon is what the public header and icon links
 * show, and none of that crosses the tenant boundary.
 *
 * `packages/utils` covers generation and the contrast check in isolation;
 * this is the end-to-end counterpart. The suite writes the seed tenant's
 * brand and puts it back in `afterEach`, so a run against a long-lived stack
 * leaves the defaults in place.
 */
test.describe("admin brand settings", () => {
  test.describe.configure({ mode: "serial" });

  let restoreTheme = false;
  let restoreLogo = false;
  let restoreIcon = false;

  test.beforeAll(() => {
    applyScenarioSql(MULTI_TENANT_SCENARIO);
  });

  test.beforeEach(async ({ page, request }) => {
    restoreTheme = false;
    restoreLogo = false;
    restoreIcon = false;
    await signInAsSeedAdmin(page, "/settings/theme");
    await expect(primaryColorField(page)).toBeVisible({ timeout: 30_000 });
    await deleteBrandingIfSet(page, "logo", "The logo was deleted.");
    await deleteBrandingIfSet(page, "icon", "The icon was deleted.");
    await restorePrimaryColor(page, request);
  });

  test.afterEach(async ({ page, request }) => {
    if (!(restoreTheme || restoreLogo || restoreIcon)) {
      return;
    }
    await signInAsSeedAdmin(page, "/settings/theme");
    await expect(primaryColorField(page)).toBeVisible({ timeout: 30_000 });
    if (restoreLogo) {
      await deleteBrandingIfSet(page, "logo", "The logo was deleted.");
    }
    if (restoreIcon) {
      await deleteBrandingIfSet(page, "icon", "The icon was deleted.");
    }
    if (restoreTheme) {
      await restorePrimaryColor(page, request);
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
    await pollHostPage(page, hostUrl("/"), async () => {
      await expect(
        page.getByRole("heading", { exact: true, name: "Catalog" })
      ).toBeVisible({ timeout: 5000 });
      return await primaryCustomProperty(page);
    }).toBe(SAVED_PRIMARY_COLOR);
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

    await pollHostPage(page, edgeUrl("/"), async () => {
      const src = await headerLogo(page).getAttribute("src");
      return src ?? "";
    }).toMatch(/^\/images\/tenants\/[^/]+\/logo(?:\?|$)/u);

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

    await pollHostPage(page, edgeUrl("/"), async () => {
      const text = await headerBrand(page).textContent();
      return text?.trim();
    }).toBe(SEED_TENANT_NAME);
    await expect(headerLogo(page)).toHaveCount(0);
  });

  test("uploading a tenant icon reaches the public icon links and a tenant with no icon declares neither", async ({
    page,
    request,
  }) => {
    await page.goto(otherHostUrl("/"));
    await expect(iconLink(page)).toHaveCount(0);
    await expect(appleTouchIconLink(page)).toHaveCount(0);

    restoreIcon = true;
    await openThemeSettings(page);
    await uploadBranding(page, "icon", "Save the icon", "The icon was saved.");

    await pollHostPage(page, hostUrl("/"), async () => {
      const href = await iconLink(page).getAttribute("href");
      return href ?? "";
    }).toMatch(/\/images\/tenants\/[^/]+\/icon(?:\?|$)/u);

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

    await pollHostPage(page, hostUrl("/"), () => iconLink(page).count()).toBe(
      0
    );
    await expect(appleTouchIconLink(page)).toHaveCount(0);
  });
});
