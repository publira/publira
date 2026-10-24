import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { signInAsAdmin } from "../src/admin";
import { applyScenarioSql, querySql } from "../src/db";
import { revalidateStorefrontTags } from "../src/revalidate";
import {
  SITE_VERIFICATION_ADMIN,
  SITE_VERIFICATION_EDITOR,
  SITE_VERIFICATION_SCENARIO,
  SITE_VERIFICATION_TENANT,
} from "../src/scenarios/site-verification";
import {
  localeStorefrontPath,
  storefrontPath,
  WEB_ADMIN_SITE_VERIFICATION_BASE_URL,
  WEB_STOREFRONT_SITE_VERIFICATION_BASE_URL,
} from "../src/urls";

/**
 * A tenant administrator saves the codes Google Search Console and Bing
 * Webmaster Tools prove the site with, from `/settings`, and every page of the
 * tenant's site carries a `<meta>` tag for each code that is set.
 *
 * The pages are fetched as each service's verifier asks for them. Both user
 * agents are ones Next.js renders metadata into `<head>` for rather than
 * streaming it into `<body>`, and `<head>` is where both services look.
 */

const SAVE = "Save the verification codes";
const SAVED = "The verification codes were saved.";
const ADMIN_ONLY =
  "Only a tenant administrator can change this setting. You have read-only access.";

const GOOGLE_CODE = "E2E-google_Verify0123";
const BING_CODE = "0123456789ABCDEF0123456789ABCDEF";

const VERIFIERS = {
  bing: "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
  google: "Mozilla/5.0 (compatible; Google-Site-Verification/1.0)",
} as const;

/** The home page, a catalog page, a sign-in page, and a prefixed locale. */
const SITE_PAGES = [
  storefrontPath("/"),
  storefrontPath("/series"),
  storefrontPath("/login"),
  localeStorefrontPath("ja", "/"),
];

/** The tag the storefront holds the codes under, with the Google tag. */
const analyticsSettingsTag = `tenant:${SITE_VERIFICATION_TENANT.id}:analytics-settings`;

const googleField = (page: Page) =>
  page.getByRole("textbox", { exact: true, name: "Google Search Console" });

const bingField = (page: Page) =>
  page.getByRole("textbox", { exact: true, name: "Bing Webmaster Tools" });

/** The stored row, as `google|bing`, or empty while there is none. */
const storedCodes = (): string =>
  querySql(`
    SELECT coalesce(s.google_site_verification, '') || '|' ||
      coalesce(s.bing_site_verification, '')
    FROM tenant_site_verification s
    WHERE s.tenant_id = '${SITE_VERIFICATION_TENANT.id}';
  `);

const openSettings = (
  page: Page,
  account: { email: string; password: string } = SITE_VERIFICATION_ADMIN
) =>
  signInAsAdmin(
    page,
    account,
    "/settings",
    WEB_ADMIN_SITE_VERIFICATION_BASE_URL
  );

/** The `content` of each verification `<meta>` in the page's `<head>`. */
const headCodes = async (
  request: APIRequestContext,
  pathname: string,
  userAgent: string
): Promise<{ google: string[]; bing: string[] }> => {
  const response = await request.get(
    `${WEB_STOREFRONT_SITE_VERIFICATION_BASE_URL}${pathname}`,
    { headers: { "user-agent": userAgent } }
  );
  expect(response.status()).toBe(200);
  const html = await response.text();
  const head =
    /<head>(?<head>[\s\S]*?)<\/head>/u.exec(html)?.groups?.head ?? "";
  const contents = (name: string) =>
    [
      ...head.matchAll(
        new RegExp(`<meta name="${name}" content="(?<content>[^"]*)"`, "gu")
      ),
    ].map(({ groups }) => groups?.content ?? "");
  return {
    bing: contents("msvalidate\\.01"),
    google: contents("google-site-verification"),
  };
};

/**
 * Every page, as each verifier fetches it, carries `expected`. A save
 * revalidates the storefront's entry rather than dropping it, so the first
 * page after it may still come from the old copy, and each page is fetched
 * again until it does not.
 */
const expectEveryPageToCarry = async (
  request: APIRequestContext,
  expected: { google: string[]; bing: string[] }
) => {
  await Promise.all(
    SITE_PAGES.flatMap((pathname) =>
      Object.values(VERIFIERS).map((userAgent) =>
        expect
          .poll(() => headCodes(request, pathname, userAgent), {
            message: `${pathname} as ${userAgent}`,
            timeout: 30_000,
          })
          .toEqual(expected)
      )
    )
  );
};

const resetTenant = async () => {
  applyScenarioSql(SITE_VERIFICATION_SCENARIO);
  // The tenant is written again under the same id, and the storefront's entry
  // for it outlives the delete.
  await revalidateStorefrontTags([analyticsSettingsTag]);
};

// One setting for one tenant, so the tests run in order rather than beside
// each other, and each starts from what the one before it saved.
test.describe.configure({ mode: "serial" });

test.describe("search engine verification codes", () => {
  test.beforeAll(async () => {
    await resetTenant();
  });

  test.afterAll(async () => {
    await resetTenant();
  });

  test("a tenant with no codes carries no verification tag", async ({
    request,
  }) => {
    await expectEveryPageToCarry(request, { bing: [], google: [] });
  });

  test("an administrator pastes Google's whole <meta> tag, which saves only its code, and every page carries it", async ({
    page,
    request,
  }) => {
    await openSettings(page);

    await expect(googleField(page)).toHaveValue("");
    await expect(bingField(page)).toHaveValue("");

    await googleField(page).fill(
      `<meta name="google-site-verification" content="${GOOGLE_CODE}" />`
    );
    await page.getByRole("button", { name: SAVE }).click();

    await expect(page.getByText(SAVED)).toBeVisible();
    await expect(googleField(page)).toHaveValue(GOOGLE_CODE);
    expect(storedCodes()).toBe(`${GOOGLE_CODE}|`);

    await page.reload();

    await expect(googleField(page)).toHaveValue(GOOGLE_CODE);
    await expect(bingField(page)).toHaveValue("");

    await expectEveryPageToCarry(request, { bing: [], google: [GOOGLE_CODE] });
  });

  test("a value that is not a code is refused on the form", async ({
    page,
  }) => {
    await openSettings(page);

    await bingField(page).fill("not a code");
    await page.getByRole("button", { name: SAVE }).click();

    await expect(
      page
        .getByText(
          "Paste the whole <meta> tag, or only its content value: up to 128 letters, digits, hyphens, and underscores."
        )
        .first()
    ).toBeVisible();
    await expect(bingField(page)).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText(SAVED)).toBeHidden();
    expect(storedCodes()).toBe(`${GOOGLE_CODE}|`);
  });

  test("an editor sees the card read-only, without the codes", async ({
    page,
  }) => {
    await openSettings(page, SITE_VERIFICATION_EDITOR);

    await expect(page.getByText(ADMIN_ONLY).first()).toBeVisible();
    await expect(page.getByRole("button", { name: SAVE })).toBeDisabled();
    await expect(googleField(page)).toBeDisabled();
    await expect(googleField(page)).toHaveValue("");
    await expect(bingField(page)).toBeDisabled();
  });

  test("an administrator clears Google's code and sets Bing's, and every page carries Bing's tag alone", async ({
    page,
    request,
  }) => {
    await openSettings(page);

    await googleField(page).fill("");
    await bingField(page).fill(` ${BING_CODE} `);
    await page.getByRole("button", { name: SAVE }).click();

    await expect(page.getByText(SAVED)).toBeVisible();
    await expect(bingField(page)).toHaveValue(BING_CODE);
    expect(storedCodes()).toBe(`|${BING_CODE}`);

    await expectEveryPageToCarry(request, { bing: [BING_CODE], google: [] });
  });
});
