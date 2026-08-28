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

const dashboardHeading = "横断オペレーションの基準点";
const rootErrorHeading = "Platform Console を表示できませんでした";

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
 */
test.describe("web-platform console error boundary", () => {
  // Isolated project `platform-error-boundary` (see playwright.config.ts).
  // Filename `.error-boundary.` is what keeps this file off the parallel
  // web-platform project; it stops platform-api-server, not the public API.
  test.describe.configure({ mode: "serial" });

  test.afterAll(() => {
    runPlatformApiServerScript("start-wait");
  });

  test("platform API 停止中の直接アクセスでエラー画面を出し、再試行で復旧できる", async ({
    page,
  }) => {
    // Sign in while the API is up: the outage below must be the thing that
    // fails the layout, not a missing session that would redirect to /login.
    await signInAsSeedPlatformSuperAdmin(page, "/");
    await expect(
      page.getByRole("heading", { level: 1, name: dashboardHeading })
    ).toBeVisible();

    try {
      runPlatformApiServerScript("stop");

      const response = await page.goto(`${WEB_PLATFORM_BASE_URL}/`);

      // Not a bare 500 from the proxy: the console answers with its own error
      // screen, which it only gets to render because routing survived.
      expect(response?.status(), await page.content()).toBe(200);
      await expect(
        page.getByRole("heading", { name: rootErrorHeading })
      ).toBeVisible();
    } finally {
      // Restore the API even if an assertion above threw, so the rest of the
      // suite does not inherit the outage.
      runPlatformApiServerScript("start-wait");
    }

    // "リトライできる" means the retry recovers, not that a button exists.
    await page.getByRole("button", { name: "再試行" }).click();

    await expect(
      page.getByRole("heading", { level: 1, name: dashboardHeading })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: rootErrorHeading })
    ).toHaveCount(0);
  });

  test("platform API 停止中でもログイン画面が表示される", async ({ page }) => {
    try {
      runPlatformApiServerScript("stop");

      const response = await page.goto(`${WEB_PLATFORM_BASE_URL}/login`);

      // The proxy decides between /login and /setup on the setup state, so an
      // outage used to answer 500 here as well.
      expect(response?.status(), await page.content()).toBe(200);
      await expect(page.getByLabel(/メールアドレス/u)).toBeVisible();
    } finally {
      runPlatformApiServerScript("start-wait");
    }
  });
});
