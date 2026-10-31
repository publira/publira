import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { applyScenarioSql } from "../src/db";
import { SEED_TENANT_ID } from "../src/scenarios/auth";
import {
  STOREFRONT_PASSKEY_READER,
  STOREFRONT_PASSKEY_SCENARIO,
} from "../src/scenarios/storefront-passkey";
import { HOST_SESSION_COOKIE_NAME, sessionCookieValue } from "../src/session";
import { storefrontPath, WEB_STOREFRONT_BASE_URL } from "../src/urls";
import {
  addVirtualAuthenticator,
  withoutPasskeyAutofill,
} from "../src/webauthn";

/**
 * A reader signing in to the site with a passkey alone, from Chromium's
 * virtual authenticator.
 *
 * The reader registers one the way an API client does: signed in with their
 * password through the public API, from the site's own origin, which is the
 * one the passkey is bound to. That keeps this suite to the sign-in page, with
 * adding a passkey from Settings › Security left to
 * `storefront.passkey-settings.spec.ts`, and it leaves the page without a
 * session cookie, so the sign-in that follows is the passkey's alone.
 *
 * The sign-in page offers the passkey twice, from **Sign in with a passkey**
 * and in the email field's autofill, and the virtual authenticator answers the
 * autofill by itself once it holds a passkey. Each way in therefore has a
 * scenario of its own, and the button's runs in a browser without autofill.
 */

const storefrontUrl = (pathname: string): string =>
  `${WEB_STOREFRONT_BASE_URL}${storefrontPath(pathname)}`;

const passkeyButton = (page: Page) =>
  page.getByRole("button", { name: "Sign in with a passkey" });

const registerPasskey = async (page: Page): Promise<void> => {
  await page.goto(storefrontUrl("/login"));
  await expect(passkeyButton(page)).toBeVisible();

  const registered = await page.evaluate(
    async ({ email, password, tenantId }) => {
      const call = async (
        method: string,
        body: object,
        token?: string
      ): Promise<Record<string, unknown>> => {
        const response = await fetch(`/rpc/publira.v1.AuthService/${method}`, {
          body: JSON.stringify({ ...body, tenant: { tenantId } }),
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          method: "POST",
        });

        if (!response.ok) {
          throw new Error(`${method}: ${response.status}`);
        }

        return response.json();
      };

      const login = await call("Login", { email, password });
      const { token } = login.accessToken as { token: string };

      const { creationOptionsJson } = await call(
        "BeginPasskeyRegistration",
        {},
        token
      );

      const credential = await navigator.credentials.create({
        publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(
          JSON.parse(creationOptionsJson as string)
        ),
      });

      const finished = await call(
        "FinishPasskeyRegistration",
        { credentialJson: JSON.stringify(credential) },
        token
      );

      return finished.passkey !== undefined;
    },
    {
      email: STOREFRONT_PASSKEY_READER.email,
      password: STOREFRONT_PASSKEY_READER.password,
      tenantId: SEED_TENANT_ID,
    }
  );

  expect(registered).toBe(true);
};

const currentSession = async (page: Page): Promise<string | undefined> =>
  sessionCookieValue(await page.context().cookies(), HOST_SESSION_COOKIE_NAME);

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  applyScenarioSql(STOREFRONT_PASSKEY_SCENARIO);
});

test.afterAll(() => {
  applyScenarioSql(STOREFRONT_PASSKEY_SCENARIO);
});

test.describe("web-storefront passkey sign-in", () => {
  test("a reader without a passkey for the site goes back to the form with a message", async ({
    page,
  }) => {
    await addVirtualAuthenticator(page);
    await page.goto(storefrontUrl("/login?returnTo=%2Fmy"));

    await passkeyButton(page).click();

    await expect(page.getByRole("status")).toContainText(
      "Try again, or sign in with your email address and password."
    );
    await expect(page).toHaveURL(/\/login\?returnTo=/u);
    expect(await currentSession(page)).toBeUndefined();
    await expect(
      page.getByRole("button", { exact: true, name: "Sign in" })
    ).toBeEnabled();
  });

  test("a reader with a passkey signs in with the button and lands where they were going", async ({
    page,
  }) => {
    await withoutPasskeyAutofill(page);
    await addVirtualAuthenticator(page);
    await registerPasskey(page);
    expect(await currentSession(page)).toBeUndefined();

    await page.goto(storefrontUrl("/login?returnTo=%2Fmy"));
    await passkeyButton(page).click();

    await expect(page).toHaveURL(/\/my\/?$/u);
    await expect(
      page.getByRole("heading", { name: "Reading history" })
    ).toBeVisible();
    expect(await currentSession(page)).toBeTruthy();
  });

  test("a reader with a passkey signs in from the email field's autofill and lands where they were going", async ({
    page,
  }) => {
    await addVirtualAuthenticator(page);
    // Checked while the authenticator holds no passkey, which leaves the
    // autofill unanswered and the page in place.
    await page.goto(storefrontUrl("/login"));
    await expect(page.getByLabel(/Email address/u)).toHaveAttribute(
      "autocomplete",
      "username webauthn"
    );
    await registerPasskey(page);
    expect(await currentSession(page)).toBeUndefined();

    // The virtual authenticator picks the passkey from the autofill itself,
    // standing in for the reader choosing it there.
    await page.goto(storefrontUrl("/login?returnTo=%2Fmy"));

    await expect(page).toHaveURL(/\/my\/?$/u);
    await expect(
      page.getByRole("heading", { name: "Reading history" })
    ).toBeVisible();
    expect(await currentSession(page)).toBeTruthy();
  });
});
