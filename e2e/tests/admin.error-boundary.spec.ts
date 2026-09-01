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
 * Route-level error boundary for the console, the `web-admin` half of #683.
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

  // The error screen is client-rendered, and the root layout cannot put the
  // tenant's stored default in `<html lang>` without awaiting — which would
  // block the whole tree for an attribute. An operator who has chosen no
  // language therefore reads it in whatever the browser asks for, so the
  // browser language is pinned to make the Japanese copy below the expected
  // copy. Carrying the stored default to the client is #1249.
  test.use({ locale: "ja-JP" });

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
      page.getByRole("heading", { level: 1, name: "ダッシュボード" })
    ).toBeVisible();

    try {
      runAdminApiServerScript("stop");

      const response = await page.goto(`${WEB_ADMIN_BASE_URL}/`);

      // Not a bare 500: the console answers with its own error screen.
      expect(response?.status(), await page.content()).toBe(200);
      await expect(
        page.getByRole("heading", {
          name: "管理コンソールを表示できませんでした",
        })
      ).toBeVisible();
    } finally {
      // Restore the API even if an assertion above threw, so the rest of the
      // suite does not inherit the outage.
      runAdminApiServerScript("start-wait");
    }

    // "リトライできる" means the retry recovers, not that a button exists.
    await page.getByRole("button", { name: "再試行" }).click();

    await expect(
      page.getByRole("heading", { level: 1, name: "ダッシュボード" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "管理コンソールを表示できませんでした",
      })
    ).toHaveCount(0);
  });
});
