import { expect, test } from "@playwright/test";

import { signInAsSeedAdmin } from "../src/admin";
import { SEED_ADMIN } from "../src/scenarios/admin-publish";

// Five minutes: the shortest stale time the App Shell still includes.
const APP_SHELL_MIN_STALE_SECONDS = 300;

const STALE_TIME_HEADER = "x-nextjs-stale-time";

interface AppShell {
  body: string;
  staleTime: number;
}

/**
 * The session read keeps no stale time of its own, so a signed-in console
 * route stays in the client cache, and in its per-session App Shell, for as
 * long as the reads that hold its data allow.
 */
test.describe("web-admin client cache", () => {
  test("a prefetched route keeps the session chrome and its reads' stale time", async ({
    page,
  }) => {
    const appShells: AppShell[] = [];
    // The response body of a prefetch is gone once the router consumes it,
    // so the App Shell is read on its way through.
    await page.route(/\/series\?_rsc=/u, async (route) => {
      const response = await route.fetch();
      const staleTime = response.headers()[STALE_TIME_HEADER];
      const body = await response.text();
      if (
        route.request().headers()["next-router-prefetch"] !== undefined &&
        staleTime !== undefined
      ) {
        appShells.push({ body, staleTime: Number(staleTime) });
      }
      await route.fulfill({ body, response });
    });

    await signInAsSeedAdmin(page, "/");

    await expect
      .poll(() => appShells.at(0)?.staleTime, { timeout: 15_000 })
      .toBeGreaterThanOrEqual(APP_SHELL_MIN_STALE_SECONDS);
    expect(appShells.at(0)?.body).toContain(SEED_ADMIN.name);
  });
});
