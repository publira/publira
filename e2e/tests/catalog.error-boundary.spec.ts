import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { startApiServer, stopApiServer } from "../src/api-server";
import { hostPath } from "../src/urls";

/**
 * Route-level error boundary: a server-side exception has to show an error
 * screen that keeps the site UI and offers a retry.
 *
 * What decides whether a reader sees that screen or a bare
 * `500 Internal Server Error` is **when** the failure happens, not which
 * boundary file exists. Measured against the production standalone build on
 * Next.js 16.3.0, with a deliberate throw injected at each position:
 *
 * | failure | direct hit | result |
 * | --- | --- | --- |
 * | thrown before the first `await` in a page or a suspended section | HTML | bare `500` (21-byte body), no boundary runs |
 * | thrown after any `await` — a failed RPC, a timer, `connection()` | HTML | `200`, static shell, error streamed into it, boundary renders |
 * | reported as a value (`ok: false`, the cached-read rule) | HTML | `200`, `SectionError` / `PageLoadError` rendered server-side |
 *
 * The static shell is flushed only once the render has yielded, so a throw in
 * the first synchronous pass aborts the response before anything is committed
 * and Next.js answers with the plain-text 500 — its own `__next_error__`
 * recovery document is not reached either, which is why adding
 * `app/global-error.tsx` changed nothing when this was measured. Once the shell
 * is out, the same throw is just an error chunk and `(site)/error.tsx` /
 * `SectionErrorBoundary` take over.
 *
 * Every read this app makes crosses the network, so a real failure lands in the
 * second row, and the cached-read rule keeps it in the third. The first row is
 * reachable only by a bug that throws synchronously at the top of a component,
 * and it is a known framework behaviour rather than a wiring mistake here:
 * a route with `generateStaticParams` loses its boundaries while it is being
 * generated on demand (vercel/next.js#62046), and the `"use cache"` variant
 * answers the same plain-text 500 while regenerating (vercel/next.js#96567).
 *
 * The test below therefore covers what a reader can actually hit: a failed read
 * on a direct hit, and 再試行 recovering from it. `catalog.outage.spec.ts` owns
 * the wider outage matrix (503 on tenant resolution, per-section degradation,
 * the failure not being cached); this file owns the retry affordance.
 */
test.describe("web-host site error boundary", () => {
  // Isolated project `catalog-error-boundary` (see playwright.config.ts).
  // Filename `.error-boundary.` is what keeps this file off the parallel
  // web-host project; it is chained after `catalog-outage` so the two
  // stopApiServer specs cannot overlap.
  test.describe.configure({ mode: "serial" });

  test.afterAll(() => {
    startApiServer();
  });

  /**
   * A series id no run has ever requested, so no `"use cache"` entry can answer
   * it and the render has to reach the API. Unique per run because 再試行 below
   * resolves it to "missing", which **is** a cacheable answer.
   */
  const uncachedSeriesId = `RETRY${randomUUID().replaceAll("-", "").slice(0, 11)}`;

  test("retry recovers a screen that failed on a direct visit", async ({
    page,
  }) => {
    // Tenant resolution is the one thing that must survive the outage: `proxy`
    // answers 503 for a Host it cannot resolve, which would end the request
    // before any page renders. A URL that matches no published page warms that
    // lookup without filling a catalog cache entry.
    await page.goto(hostPath("/no-such-page-for-the-error-boundary-spec"));
    await expect(
      page.getByRole("heading", { level: 1, name: "ページが見つかりません" })
    ).toBeVisible();

    try {
      stopApiServer();

      const response = await page.goto(hostPath(`/series/${uncachedSeriesId}`));

      // The point of the whole issue: a failing route answers with the site's
      // own error screen, not a bare 500.
      expect(response?.status(), await page.content()).toBe(200);
      await expect(
        page.getByText("ページを表示できませんでした")
      ).toBeVisible();
      // Site chrome survives — the failure is inside the layout, not above it.
      await expect(
        page.getByRole("link", { exact: true, name: "シリーズ" })
      ).toBeVisible();
    } finally {
      // Restore the API even if an assertion above threw, so the rest of the
      // suite does not inherit the outage.
      startApiServer();
    }

    // "リトライできる" means the retry recovers, not that a button exists: a
    // no-op retry has to fail this test. The failed read was never stored, so
    // this re-run reaches the healthy API and gets the real answer for an id
    // that does not exist — the 404 UI, still inside the site chrome.
    await page.getByRole("button", { name: "再試行" }).click();

    await expect(
      page.getByRole("heading", { level: 1, name: "ページが見つかりません" })
    ).toBeVisible();
    await expect(page.getByText("ページを表示できませんでした")).toHaveCount(0);
    await expect(
      page.getByRole("link", { exact: true, name: "シリーズ" })
    ).toBeVisible();
  });
});
