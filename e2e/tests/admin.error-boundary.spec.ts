import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { signInAsSeedAdmin } from "../src/admin";
import { WEB_ADMIN_BASE_URL } from "../src/urls";

const adminApiServerScript = path.join(
  import.meta.dirname,
  "../scripts/admin-api-server.sh"
);

// Absolute path avoids PATH lookup (oxlint sonarjs/no-os-command-from-path).
// `/bin/bash` rather than `/usr/bin/bash`: only the former exists on macOS.
const bashBin = process.env.BASH_BIN?.trim() || "/bin/bash";

const runAdminApiServerScript = (action: "start-wait" | "stop"): void => {
  execFileSync(bashBin, [adminApiServerScript, action], { stdio: "inherit" });
};

/**
 * Route-level error boundary for the console.
 *
 * The reach rule the web-host spec measures is a framework one, so this app
 * gets the same coverage rather than an assumption that it inherits it: a
 * failure raised after the static shell has been flushed reaches the boundary
 * on a **direct hit**, not only on a client navigation.
 *
 * Which boundary catches it differs from web-host, and that is the point of
 * asserting it here. The console reads its session and tenant in
 * `(protected)/layout.tsx`, so an admin API outage fails that layout — above
 * `(protected)/error.tsx` — and `app/[tenant_id]/error.tsx` takes over with no
 * console chrome around it. A failure inside a page instead is caught by the
 * `SectionErrorBoundary` around that section, which
 * `admin.publish-flow.spec.ts` exercises as part of the normal flows.
 */
test.describe("web-admin console error boundary", () => {
  // Isolated project `admin-error-boundary` (see playwright.config.ts).
  // Filename `.error-boundary.` is what keeps this file off the parallel
  // web-admin project; it stops admin-api-server, not the public API.
  test.describe.configure({ mode: "serial" });

  // The browser asks for English for this whole file, and every screen below is
  // asserted in Japanese: that is the language this tenant saved
  // (`db/seeds/dev/001_tenant_users.sql`), and none of them may swap it for the
  // visitor's. The error screen is the case that needed work — it is
  // client-rendered, so the outage that brings it up takes the saved default
  // out of reach — and it reaches that language through the
  // `publira_resolved_locale` cookie the proxy publishes on every response.
  test.use({ locale: "en-US" });

  test.afterAll(() => {
    runAdminApiServerScript("start-wait");
  });

  test("a direct visit while the admin API is down shows the error screen, and retry recovers", async ({
    page,
  }) => {
    // Sign in while the API is up: the outage below must be the thing that
    // fails the layout, not a missing session that would redirect to /login.
    await signInAsSeedAdmin(page, "/");
    await expect(
      page.getByRole("heading", { level: 1, name: "Dashboard" })
    ).toBeVisible();

    // This operator has chosen no display language, so the document names one
    // only because the proxy published what the tenant saved.
    await expect(page.locator("html")).toHaveAttribute("lang", "en");

    try {
      runAdminApiServerScript("stop");

      const response = await page.goto(`${WEB_ADMIN_BASE_URL}/`);

      // Not a bare 500: the console answers with its own error screen.
      expect(response?.status(), await page.content()).toBe(200);
      // The admin API is what holds the saved language, and it is down: the
      // error screen words itself from the cookie the proxy left behind rather
      // than from the English this browser asks for.
      await expect(
        page.getByRole("heading", {
          name: "Could not display the admin console",
        })
      ).toBeVisible();
    } finally {
      // Restore the API even if an assertion above threw, so the rest of the
      // suite does not inherit the outage.
      runAdminApiServerScript("start-wait");
    }

    // "can retry" means the retry recovers, not that a button exists.
    await page.getByRole("button", { name: "Retry" }).click();

    await expect(
      page.getByRole("heading", { level: 1, name: "Dashboard" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Could not display the admin console",
      })
    ).toHaveCount(0);
  });
});
