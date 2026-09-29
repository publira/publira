import { generateKeyPairSync } from "node:crypto";

import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { signInAsAdmin } from "../src/admin";
import { applyScenarioSql, querySql } from "../src/db";
import {
  SIGN_IN_PROVIDERS_ADMIN,
  SIGN_IN_PROVIDERS_SCENARIO,
  SIGN_IN_PROVIDERS_TENANT,
} from "../src/scenarios/sign-in-providers";
import {
  WEB_ADMIN_SIGN_IN_PROVIDERS_BASE_URL,
  WEB_HOST_SIGN_IN_PROVIDERS_BASE_URL,
} from "../src/urls";

/**
 * A tenant administrator offering their readers Sign in with Apple and Google,
 * and switching one of them off again, and the providers the tenant's public
 * API then names.
 */

const SIGN_IN_PATH = "/integrations/sign-in";

const SAVED = "The sign-in providers were saved.";
const SUBMIT = "Save the sign-in providers";

const SERVICES_ID = "com.example.web";
const WEB_CLIENT_ID = "123456789012-abc123.apps.googleusercontent.com";

// Generated per run: a real P-256 key is what the server accepts, and one that
// never leaves this process is not a secret to commit.
const APPLE_KEY = generateKeyPairSync("ec", {
  namedCurve: "P-256",
  privateKeyEncoding: { format: "pem", type: "pkcs8" },
  publicKeyEncoding: { format: "pem", type: "spki" },
}).privateKey;

const tenantRow = `(
  SELECT id FROM tenants
  WHERE public_id = '${SIGN_IN_PROVIDERS_TENANT.publicId}'
)`;

// Scalar subqueries, so a tenant with no row still answers `none`.
const storedApple = (): string =>
  querySql(`
    SELECT COALESCE((
      SELECT concat_ws(
        '|',
        enabled::text,
        COALESCE(services_id, '-'),
        COALESCE(team_id, '-'),
        COALESCE(key_id, '-'),
        COALESCE(left(private_key_encrypted, 4), '-')
      )
      FROM tenant_apple_sign_in_config
      WHERE tenant_id = ${tenantRow}
    ), 'none');
  `);

const storedGoogle = (): string =>
  querySql(`
    SELECT COALESCE((
      SELECT concat_ws(
        '|',
        enabled::text,
        COALESCE(web_client_id, '-'),
        COALESCE(ios_client_id, '-')
      )
      FROM tenant_google_sign_in_config
      WHERE tenant_id = ${tenantRow}
    ), 'none');
  `);

interface OfferedProviders {
  appleSignIn?: { servicesId?: string };
  googleSignIn?: { webClientId?: string; iosClientId?: string };
}

/**
 * The public tenant read the site revalidates, asked for from the tenant's own
 * site so it goes through the same edge.
 */
const offeredProviders = async (page: Page): Promise<OfferedProviders> => {
  const tenantId = querySql(`SELECT ${tenantRow};`);
  const body = await page.evaluate(async (id) => {
    const response = await fetch("/api/publira.v1.TenantService/GetTenant", {
      body: JSON.stringify({ tenant: { tenantId: id } }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    return (await response.json()) as OfferedProviders;
  }, tenantId);
  return { appleSignIn: body.appleSignIn, googleSignIn: body.googleSignIn };
};

const openSignInSettings = async (page: Page): Promise<void> => {
  await page.goto(`${WEB_ADMIN_SIGN_IN_PROVIDERS_BASE_URL}${SIGN_IN_PATH}`);
  await expect(page.getByRole("button", { name: SUBMIT })).toBeVisible();
};

const provider = (page: Page, legend: "Apple" | "Google"): Locator =>
  page.getByRole("group", { exact: true, name: legend });

/** The state a provider's chip names. */
const status = (
  page: Page,
  legend: "Apple" | "Google",
  label: "Not set" | "Off" | "Offered"
): Locator => provider(page, legend).getByText(label, { exact: true });

const toggle = (page: Page, legend: "Apple" | "Google"): Locator =>
  page.getByRole("checkbox", { name: `Offer Sign in with ${legend}` });

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  applyScenarioSql(SIGN_IN_PROVIDERS_SCENARIO);
});

test.afterAll(() => {
  applyScenarioSql(SIGN_IN_PROVIDERS_SCENARIO);
});

test.describe("sign-in providers", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(
      page,
      SIGN_IN_PROVIDERS_ADMIN,
      SIGN_IN_PATH,
      WEB_ADMIN_SIGN_IN_PROVIDERS_BASE_URL
    );
  });

  test("offers both providers and keeps the Apple key write-only", async ({
    page,
    context,
  }) => {
    await openSignInSettings(page);
    await expect(status(page, "Apple", "Not set")).toBeVisible();
    await expect(status(page, "Google", "Not set")).toBeVisible();
    await expect(page.getByLabel("iOS bundle ID")).toHaveValue(
      SIGN_IN_PROVIDERS_TENANT.iosBundleIdentifier
    );

    await toggle(page, "Apple").click();
    await page.getByLabel("Services ID").fill(SERVICES_ID);
    await page.getByLabel("Team ID").fill("abcde12345");
    await page.getByLabel("Key ID").fill("2x9r4hxf34");
    await page.locator('input[name="apple_private_key_file"]').setInputFiles({
      buffer: Buffer.from(APPLE_KEY),
      mimeType: "application/octet-stream",
      name: "AuthKey_2X9R4HXF34.p8",
    });
    await toggle(page, "Google").click();
    await page.getByLabel("Web client ID").fill(WEB_CLIENT_ID);
    await page.getByRole("button", { name: SUBMIT }).click();

    await expect(page.getByText(SAVED)).toBeVisible();
    await expect(status(page, "Apple", "Offered")).toBeVisible();
    await expect(status(page, "Google", "Offered")).toBeVisible();
    expect(storedApple()).toBe(
      `true|${SERVICES_ID}|ABCDE12345|2X9R4HXF34|enc:`
    );
    expect(storedGoogle()).toBe(`true|${WEB_CLIENT_ID}|-`);

    await page.reload();
    await expect(page.getByLabel("Team ID")).toHaveValue("ABCDE12345");
    await expect(page.getByLabel("Private key (.p8)")).not.toHaveValue("");
    expect(await page.content()).not.toContain("PRIVATE KEY");

    // The API revalidates the site's tenant read as the save lands, so the
    // site names both providers from here on.
    const site = await context.newPage();
    await site.goto(WEB_HOST_SIGN_IN_PROVIDERS_BASE_URL);
    await expect
      .poll(() => offeredProviders(site))
      .toStrictEqual({
        appleSignIn: { servicesId: SERVICES_ID },
        googleSignIn: { webClientId: WEB_CLIENT_ID },
      });
  });

  test("keeps what was typed when a value is refused", async ({ page }) => {
    await openSignInSettings(page);
    const before = storedGoogle();

    await page.getByLabel("iOS client ID").fill("ios.example.com");
    await page.getByRole("button", { name: SUBMIT }).click();

    await expect(
      page.getByText(
        "Enter a client ID ending in .apps.googleusercontent.com, as the Google Cloud console shows it."
      )
    ).toBeVisible();
    await expect(page.getByLabel("iOS client ID")).toHaveValue(
      "ios.example.com"
    );
    expect(storedGoogle()).toBe(before);
  });

  test("withdraws a provider switched off and keeps what it had", async ({
    page,
    context,
  }) => {
    await openSignInSettings(page);

    await toggle(page, "Google").click();
    await page.getByRole("button", { name: SUBMIT }).click();

    await expect(page.getByText(SAVED)).toBeVisible();
    await expect(status(page, "Google", "Off")).toBeVisible();
    expect(storedGoogle()).toBe(`false|${WEB_CLIENT_ID}|-`);
    await expect(page.getByLabel("Web client ID")).toHaveValue(WEB_CLIENT_ID);

    const site = await context.newPage();
    await site.goto(WEB_HOST_SIGN_IN_PROVIDERS_BASE_URL);
    await expect
      .poll(() => offeredProviders(site))
      .toStrictEqual({
        appleSignIn: { servicesId: SERVICES_ID },
        googleSignIn: undefined,
      });
  });

  test("records each save in the audit log", async ({ page }) => {
    await page.goto(
      `${WEB_ADMIN_SIGN_IN_PROVIDERS_BASE_URL}/audit-logs?action=tenant_sign_in_settings_updated`
    );

    // Newest first: the save that switched Google off.
    const latest = page.getByRole("row").nth(1);
    await expect(latest).toContainText("Sign-in providers updated");
    await expect(latest).toContainText(
      `Sign-in providers / ${SIGN_IN_PROVIDERS_TENANT.publicId}`
    );
    await expect(latest).toContainText("google.enabled=false");
  });
});
