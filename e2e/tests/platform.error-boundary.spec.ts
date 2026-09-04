import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { signInAsSeedPlatformSuperAdmin } from "../src/platform";
import { WEB_PLATFORM_BASE_URL } from "../src/urls";

const platformApiServerScript = path.join(
  import.meta.dirname,
  "../scripts/platform-api-server.sh"
);

// Absolute path avoids PATH lookup (oxlint sonarjs/no-os-command-from-path).
// `/bin/bash` rather than `/usr/bin/bash`: only the former exists on macOS.
const bashBin = process.env.BASH_BIN?.trim() || "/bin/bash";

const runPlatformApiServerScript = (action: "start-wait" | "stop"): void => {
  execFileSync(bashBin, [platformApiServerScript, action], {
    stdio: "inherit",
  });
};

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
 * `app/error.tsx` and the screen renders with no console chrome around it —
 * the same shape `admin.error-boundary.spec.ts` asserts for `web-admin`.
 *
 * Reaching that boundary at all depends on the proxy, which is why the login
 * screen is measured here too. The proxy resolves the setup state on every
 * path it matches, and a read that throws there answers a bare 500 for the
 * whole console before any page renders.
 *
 * The browser asks for English for this whole file. The console screens are
 * asserted in Japanese, because that is the language this platform saved
 * (`db/seeds/dev/001_tenant_users.sql`) and none of them may swap it for the
 * visitor's; `/setup` is asserted in English, because it runs before a language
 * has been saved and has nothing but `Accept-Language` to go on.
 *
 * The error screen is the case that needed work — it is client-rendered, so the
 * outage that brings it up takes the saved default out of reach — and it
 * reaches that language now through the `publira_resolved_locale` cookie the
 * proxy publishes on every response.
 */
test.describe("web-platform console error boundary", () => {
  // Isolated project `platform-error-boundary` (see playwright.config.ts).
  // Filename `.error-boundary.` is what keeps this file off the parallel
  // web-platform project; it stops platform-api-server, not the public API.
  test.describe.configure({ mode: "serial" });

  test.afterAll(() => {
    runPlatformApiServerScript("start-wait");
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
      runPlatformApiServerScript("stop");

      const response = await page.goto(`${WEB_PLATFORM_BASE_URL}/`);

      // Not a bare 500 from the proxy: the console answers with its own error
      // screen, which it only gets to render because routing survived.
      expect(response?.status(), await page.content()).toBe(200);
      // The platform API is what holds the saved language, and it is down: the
      // error screen words itself from the cookie the proxy left behind rather
      // than from the English this browser asks for.
      await expect(
        page.getByRole("heading", { name: rootErrorHeading })
      ).toBeVisible();
    } finally {
      // Restore the API even if an assertion above threw, so the rest of the
      // suite does not inherit the outage.
      runPlatformApiServerScript("start-wait");
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
      runPlatformApiServerScript("stop");

      const response = await page.goto(`${WEB_PLATFORM_BASE_URL}/login`);

      // The proxy decides between /login and /setup on the setup state, so an
      // outage used to answer 500 here as well.
      expect(response?.status(), await page.content()).toBe(200);
      await expect(page.getByLabel(/Email address/u)).toBeVisible();
    } finally {
      runPlatformApiServerScript("start-wait");
    }
  });

  test("/setup shows the connection error and no form while the platform API is down", async ({
    page,
  }) => {
    try {
      runPlatformApiServerScript("stop");

      const response = await page.goto(`${WEB_PLATFORM_BASE_URL}/setup`);

      expect(response?.status(), await page.content()).toBe(200);
      await expect(page.getByText(setupApiUnavailableMessage)).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Create administrator" })
      ).toHaveCount(0);
    } finally {
      runPlatformApiServerScript("start-wait");
    }
  });
});
