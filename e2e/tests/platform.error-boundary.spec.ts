import { expect, test } from "@playwright/test";

import { signInAsSeedPlatformSuperAdmin } from "../src/platform";
import { startServer, stopServer } from "../src/server";
import { WEB_PLATFORM_BASE_URL } from "../src/urls";

const dashboardHeading = "Cross-tenant operations hub";
const rootErrorHeading = "Could not display Platform Console";

// `/setup` runs before a language has been saved, so it is the one screen here
// that follows the browser rather than the platform.
const setupApiUnavailableMessage =
  "Cannot reach the API server. Check that it is running, then try again.";

/**
 * Route-level error boundary for Platform Console.
 *
 * The console reads its operator in `(protected)/layout.tsx`, which sits above
 * `(protected)/error.tsx`, so a platform API outage is caught by
 * `app/[locale]/error.tsx` and the screen renders with no console chrome
 * around it — the same shape `admin.error-boundary.spec.ts` asserts for
 * `web-admin`.
 *
 * Reaching that boundary at all depends on the proxy, which is why the login
 * screen is measured here too. The proxy resolves the setup state on every
 * path it matches, and a read that throws there answers a bare 500 for the
 * whole console before any page renders.
 *
 * The browser asks for English for this whole file. The console screens are
 * asserted in English, because that is the language this platform saved
 * (`db/seeds/dev/001_tenant_users.sql`) and none of them may swap it for the
 * visitor's; `/setup` is asserted in English too, because it runs before a
 * language has been saved and has nothing but `Accept-Language` to go on.
 *
 * The error screen reads `PlatformMessagesProvider`. The provider follows the
 * `[locale]` segment `proxy.ts` rewrote the request onto, and that read needs
 * nothing from the platform API, so the catalog is in the response and the
 * browser does not fetch one. While the API is down the proxy keeps the last
 * language it confirmed, which is the language the screen renders in.
 */
test.describe("web-platform console error boundary", () => {
  // Isolated project `platform-error-boundary` (see playwright.config.ts).
  // Filename `.error-boundary.` is what keeps this file off the parallel
  // web-platform project, and the project chain keeps it off the other specs
  // that stop the API: one process serves all three namespaces.
  test.describe.configure({ mode: "serial" });

  test.afterAll(() => {
    startServer();
  });

  test.use({ locale: "en-US" });

  test("a direct visit while the platform API is down shows the error screen, and retry recovers", async ({
    page,
  }) => {
    // Sign in while the API is up: the outage below must be the thing that
    // fails the layout, not a missing session that would redirect to /login.
    await signInAsSeedPlatformSuperAdmin(page, "/");
    await expect(
      page.getByRole("heading", { level: 1, name: dashboardHeading })
    ).toBeVisible();

    // This operator has chosen no display language, so the document names one
    // only because the proxy published what the platform saved.
    await expect(page.locator("html")).toHaveAttribute("lang", "en");

    try {
      stopServer();

      const response = await page.goto(`${WEB_PLATFORM_BASE_URL}/`);

      // Not a bare 500 from the proxy: the console answers with its own error
      // screen, which it only gets to render because routing survived.
      expect(response?.status(), await page.content()).toBe(200);
      // The proxy rewrote this request onto the language the platform saved.
      // The error screen reads that segment through the provider, so the copy
      // stays in that language while the API is down.
      await expect(
        page.getByRole("heading", { name: rootErrorHeading })
      ).toBeVisible();
    } finally {
      // Restore the API even if an assertion above threw, so the rest of the
      // suite does not inherit the outage.
      startServer();
    }

    // "can retry" means the retry recovers, not that a button exists.
    await page.getByRole("button", { name: "Retry" }).click();

    await expect(
      page.getByRole("heading", { level: 1, name: dashboardHeading })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: rootErrorHeading })
    ).toHaveCount(0);
  });

  test("the login screen still renders while the platform API is down", async ({
    page,
  }) => {
    try {
      stopServer();

      const response = await page.goto(`${WEB_PLATFORM_BASE_URL}/login`);

      // The proxy decides between /login and /setup on the setup state, so an
      // outage used to answer 500 here as well.
      expect(response?.status(), await page.content()).toBe(200);
      await expect(page.getByLabel(/Email address/u)).toBeVisible();
    } finally {
      startServer();
    }
  });

  test("/setup shows the connection error and no form while the platform API is down", async ({
    page,
  }) => {
    try {
      stopServer();

      const response = await page.goto(`${WEB_PLATFORM_BASE_URL}/setup`);

      expect(response?.status(), await page.content()).toBe(200);
      await expect(page.getByText(setupApiUnavailableMessage)).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Create administrator" })
      ).toHaveCount(0);
    } finally {
      startServer();
    }
  });
});
