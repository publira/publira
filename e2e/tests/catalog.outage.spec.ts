import { expect, test } from "@playwright/test";

import { startApiServer, stopApiServer } from "../src/api-server";
import { uncachedTenantBaseUrl } from "../src/urls";

/**
 * Public API outage. Tenant resolution is the first backend call every request
 * makes, so it is where an unreachable API has to degrade predictably: 503 with
 * `Retry-After`, never a tenant mix-up and never a hang.
 *
 * Each navigation uses a Host that has never been resolved before, so
 * web-host's in-process tenant cache cannot answer it.
 */
test.describe("web-host public API outage", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(() => {
    stopApiServer();
  });

  test.afterAll(() => {
    startApiServer();
  });

  test("テナント解決できない間は 503 と Retry-After を返す", async ({
    page,
  }) => {
    const response = await page.goto(`${uncachedTenantBaseUrl()}/`);

    expect(response?.status(), await page.content()).toBe(503);
    expect(response?.headers()["retry-after"]).toBe("30");
  });

  /**
   * Data fetches degrade far worse than tenant resolution: the helpers run
   * inside a `"use cache"` scope, so their error is not observable by the
   * page's try/catch and the route answers a bare `500 Internal Server Error`
   * body instead of any fallback.
   *
   * Enable once https://github.com/publira/publira/issues/672 lands. The final
   * copy and status code are decided there, so this pins the user-visible
   * contract only: the site chrome survives and a retry affordance exists.
   */
  test.skip("データ取得に失敗してもサイト UI を保ったフォールバックを表示する", async ({
    page,
  }) => {
    // A public_id no other spec requests, so no `"use cache"` entry can
    // answer it and the render has to reach the unavailable API.
    await page.goto("/series/OUTAGE000001");

    await expect(
      page.getByRole("link", { exact: true, name: "Series" })
    ).toBeVisible();
    await expect(page.getByText(/再試行|再読み込み/u)).toBeVisible();
  });

  test("復旧後は同じ導線が通常どおり応答する", async ({ page }) => {
    startApiServer();

    // Another never-resolved Host: 503 → 404 means tenant resolution reached
    // the API again and got a definitive answer, not a cached one.
    const resolved = await page.goto(`${uncachedTenantBaseUrl()}/`);
    expect(resolved?.status(), await page.content()).toBe(404);

    const response = await page.goto("/");
    expect(response?.status(), await page.content()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "カタログトップ" })
    ).toBeVisible();
  });
});
