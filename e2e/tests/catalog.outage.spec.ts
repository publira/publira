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
   * inside a `"use cache"` scope, so their error was not observable by the
   * `try` / `catch` the pages used to carry, and the route answered a bare
   * `500 Internal Server Error` body instead of any fallback.
   *
   * Those `catch` blocks are gone as of #647 — the sections now sit inside a
   * `SectionErrorBoundary` (`catchError`). Whether a throw crossing a
   * `"use cache"` scope reaches that boundary is the open question, and it is
   * measured in https://github.com/publira/publira/issues/672.
   *
   * Unlike its neighbours this one navigates the default Host, and that is
   * load-bearing: `stopApiServer()` breaks tenant resolution too, and `proxy`
   * answers 503 for a Host it cannot resolve — which would end the request
   * before any section renders. The default Host survives only because an
   * earlier spec already resolved it into the `createTenantIdResolver` LRU
   * (`max: 500`, `ttl: 300_000`), so the outage reaches the catalog read and
   * nothing else. Whoever enables this should not rely on that by accident:
   * either assert the tenant still resolves first, or give #672 a fault
   * injection that fails the catalog read alone.
   *
   * Enable once that lands. The final copy and status code are decided there,
   * so this pins the user-visible contract only: the site chrome survives and
   * a retry affordance exists.
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
