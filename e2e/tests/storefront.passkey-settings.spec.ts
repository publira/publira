import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { applyScenarioSql, querySql, quoteSqlLiteral } from "../src/db";
import { SEED_TENANT_ID } from "../src/scenarios/auth";
import {
  PASSKEY_SETTINGS_READER,
  PASSWORDLESS_PASSKEY_READER,
  STOREFRONT_PASSKEY_SETTINGS_SCENARIO,
} from "../src/scenarios/storefront-passkey-settings";
import {
  fillLoginForm,
  HOST_SESSION_COOKIE_NAME,
  plantSessionCookie,
} from "../src/session";
import { storefrontPath, WEB_STOREFRONT_BASE_URL } from "../src/urls";
import { addVirtualAuthenticator } from "../src/webauthn";

/**
 * A reader managing their passkeys from **Settings** › **Security**, with
 * Chromium's virtual authenticator answering every prompt.
 */

const storefrontUrl = (pathname: string): string =>
  `${WEB_STOREFRONT_BASE_URL}${storefrontPath(pathname)}`;

const passkeysSection = (page: Page) =>
  page.getByRole("region", { name: "Passkeys" });

/**
 * Add a passkey from **Passkeys** and name it, or skip naming it when no name
 * is given, ending back on the add form.
 */
const addPasskey = async (page: Page, name?: string): Promise<void> => {
  const section = passkeysSection(page);
  await section.getByRole("button", { name: "Add a passkey" }).click();
  await expect(section.getByRole("status")).toContainText(
    "The passkey has been added."
  );
  if (name) {
    await section.getByLabel("Name this passkey").fill(name);
    await section.getByRole("button", { name: "Save" }).click();
  } else {
    await section.getByRole("button", { name: "Skip" }).click();
  }
  await expect(
    section.getByRole("button", { name: "Add a passkey" })
  ).toBeVisible();
};

/**
 * Sign in from **Sign in** with the passkey the virtual authenticator holds.
 *
 * The page also offers the reader's passkeys in the email field's autofill,
 * and the virtual authenticator may answer that request by itself before the
 * button is reached. Either way the passkey alone signs the reader in, so a
 * click the autofill got ahead of is not a failure; landing on `returnTo` is
 * what is asserted.
 */
const signInWithPasskey = async (page: Page): Promise<void> => {
  const signedIn = page.waitForURL(/\/settings\/security\/?$/u);
  try {
    await page
      .getByRole("button", { name: "Sign in with a passkey" })
      .click({ timeout: 10_000 });
  } catch {
    // The autofill signed the reader in first, taking the button away.
  }
  await signedIn;
};

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  applyScenarioSql(STOREFRONT_PASSKEY_SETTINGS_SCENARIO);
});

test.afterAll(() => {
  applyScenarioSql(STOREFRONT_PASSKEY_SETTINGS_SCENARIO);
});

test.describe("web-storefront passkey settings", () => {
  test("a reader adds a passkey, signs in with it, and removes it", async ({
    page,
  }) => {
    await addVirtualAuthenticator(page);
    await page.goto(storefrontUrl("/login?returnTo=%2Fsettings%2Fsecurity"));
    await fillLoginForm(page, PASSKEY_SETTINGS_READER);
    await expect(page).toHaveURL(/\/settings\/security\/?$/u);

    await expect(passkeysSection(page)).toContainText(
      "No passkeys are registered."
    );
    await addPasskey(page, "E2E laptop");
    await expect(passkeysSection(page).getByText("E2E laptop")).toBeVisible();
    await expect(passkeysSection(page)).toContainText("Not used yet");

    // Signed out, the passkey alone signs the reader back in.
    await page.context().clearCookies();
    await page.goto(storefrontUrl("/login?returnTo=%2Fsettings%2Fsecurity"));
    await signInWithPasskey(page);
    await expect(passkeysSection(page)).toContainText("Last used on");

    await passkeysSection(page)
      .getByRole("button", { name: "Remove E2E laptop" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "The passkey has been removed."
    );
    await expect(passkeysSection(page)).toContainText(
      "No passkeys are registered."
    );
  });

  test("an account without a password keeps its last passkey and confirms with it", async ({
    page,
  }) => {
    await addVirtualAuthenticator(page);
    await plantSessionCookie(
      page,
      HOST_SESSION_COOKIE_NAME,
      WEB_STOREFRONT_BASE_URL,
      {
        audience: "public",
        subject: PASSWORDLESS_PASSKEY_READER.publicId,
        tenantId: SEED_TENANT_ID,
      }
    );
    await page.goto(storefrontUrl("/settings/security"));
    await expect(
      page.getByRole("heading", { name: "Set a password" })
    ).toBeVisible();

    await addPasskey(page);
    const section = passkeysSection(page);
    await expect(section.getByText("Unnamed passkey")).toBeVisible();
    await expect(
      section.getByRole("button", { name: "Remove Unnamed passkey" })
    ).toBeDisabled();
    await expect(section).toContainText(
      "Your account has no password or linked account, so its last passkey stays registered."
    );

    const emailChange = page.getByRole("region", {
      name: "Change email address",
    });
    await emailChange
      .getByLabel("Current email address")
      .fill(PASSWORDLESS_PASSKEY_READER.email);
    await emailChange
      .getByLabel("New email address")
      .fill("passkey-passwordless-moved@example.com");
    await emailChange
      .getByRole("button", { name: "Confirm with a passkey" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "We sent a confirmation email to both your current and your new address."
    );

    await page.goto(storefrontUrl("/settings"));
    await page.getByRole("button", { name: "Delete account" }).click();
    const dialog = page.getByRole("dialog", {
      name: "Confirm account deletion",
    });
    await expect(dialog).toContainText(
      "Your account has no password. Confirm with a passkey or a linked account."
    );
    await dialog
      .getByRole("button", { name: "Confirm with a passkey" })
      .click();
    await page.waitForURL((url) => url.pathname.endsWith("/login"));
    expect(
      querySql(
        `SELECT count(*) FROM users WHERE public_id = ${quoteSqlLiteral(PASSWORDLESS_PASSKEY_READER.publicId)}`
      )
    ).toBe("0");
  });
});
