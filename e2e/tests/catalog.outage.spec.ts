import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { startApiServer, stopApiServer } from "../src/api-server";
import { uncachedTenantBaseUrl } from "../src/urls";

/**
 * A series id no run has ever requested, so no `"use cache"` entry can answer
 * it and the render has to reach the API. Unique per run because the recovery
 * test below then resolves it to "missing", which **is** a cacheable answer —
 * reusing a fixed id would make the outage assertion pass only on a cold stack.
 */
const uncachedSeriesId = `OUTAGE${randomUUID().replaceAll("-", "").slice(0, 10)}`;

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
   * Data fetches used to degrade far worse than tenant resolution: the helpers
   * run inside a `"use cache"` scope, and a cache fill that throws fails the
   * whole request — the awaiting `try` / `catch` never ran, and the route
   * answered a bare `500 Internal Server Error` body instead of any fallback.
   *
   * As of #672 no cached read throws: each one reports failure as a value and
   * drops its own cache entry, so the page renders `SectionError` (a section
   * inside `<Suspense>`) or `PageLoadError` (a detail route, where that read is
   * the whole page). A missing record answers HTTP 200 with the not-found UI,
   * because the shell has been committed by the time `notFound()` runs — that
   * contract belongs to `catalog.not-found.spec.ts`.
   *
   * Outage **and** recovery live in one test on purpose: "the failure was not
   * cached" is only a claim about a URL this test itself failed a moment ago,
   * so splitting them would let the recovery half pass without ever having
   * seen a failure.
   *
   * Unlike its neighbours this one navigates the default Host, and that is
   * load-bearing: `stopApiServer()` breaks tenant resolution too, and `proxy`
   * answers 503 for a Host it cannot resolve — which would end the request
   * before any section renders. The default Host survives only because an
   * earlier navigation resolved it into the `createTenantIdResolver` LRU
   * (`max: 500`, `ttl: 300_000`), so the outage reaches the catalog read and
   * nothing else. The first navigation below happens while the API is still up
   * for exactly that reason: it asserts the tenant resolves rather than
   * relying on another spec having warmed the cache first.
   */
  test("データ取得の失敗はフォールバックを出し、復旧後はキャッシュされない", async ({
    page,
  }) => {
    // Tenant resolution must be the thing that still works, so warm it against
    // a healthy API and assert it before the outage starts. A URL that matches
    // no published page warms the tenant lookup without filling any catalog
    // cache entry, which is what keeps the reads below cold.
    startApiServer();
    await page.goto("/no-such-page-in-any-spec");
    await expect(
      page.getByRole("heading", { level: 1, name: "ページが見つかりません" })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { exact: true, name: "Series" })
    ).toBeVisible();

    try {
      stopApiServer();

      const response = await page.goto(`/series/${uncachedSeriesId}`);

      expect(response?.status(), await page.content()).toBe(200);
      await expect(
        page.getByRole("link", { exact: true, name: "Series" })
      ).toBeVisible();
      // `getByRole("alert")` also matches Next.js's route announcer, so assert
      // the failure display by its own copy and its retry affordance.
      await expect(
        page.getByText("ページを表示できませんでした")
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "再試行" })).toBeVisible();

      // A list page degrades per section instead: the page heading and the site
      // chrome stay, and only the section that could not load is replaced. The
      // cursor token is base64url-shaped (so it survives `cursorTokenSchema`)
      // and is requested by no other spec, which keeps this list read cold — a
      // page whose entry is already cached would rightly answer from the cache
      // and prove nothing.
      await page.goto("/series?token=OUTAGE00");
      await expect(
        page.getByRole("heading", { level: 1, name: "シリーズ一覧" })
      ).toBeVisible();
      await expect(
        page.getByText("シリーズ一覧を表示できませんでした")
      ).toBeVisible();
    } finally {
      // Restore the API even if an assertion above threw, so the rest of the
      // suite does not inherit the outage.
      startApiServer();
    }

    // Same URL, no revalidation and no wait: the failure just rendered must not
    // have been stored, so the next request shows the real answer — which for
    // this id is "not found", not the failure display.
    await page.goto(`/series/${uncachedSeriesId}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "ページが見つかりません" })
    ).toBeVisible();
    await expect(page.getByText("ページを表示できませんでした")).toHaveCount(0);

    // The list is checked without the token: a healthy API rejects
    // `OUTAGE00` as a malformed cursor, so that URL shows a section failure by
    // design and says nothing about caching.
    await page.goto("/series");
    await expect(
      page.getByText("シリーズ一覧を表示できませんでした")
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { level: 1, name: "シリーズ一覧" })
    ).toBeVisible();
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
