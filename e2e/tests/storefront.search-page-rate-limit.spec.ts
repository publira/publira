import "temporal-polyfill/global";
import { randomInt } from "node:crypto";
import { setTimeout } from "node:timers/promises";

import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "@playwright/test";

import {
  WEB_STOREFRONT_BASE_URL,
  WEB_STOREFRONT_INTERNAL_URL,
} from "../src/urls";

/** How many search page requests web-storefront admits from one client in a window. */
const SEARCH_PAGE_LIMIT = 80;
const WINDOW_MILLISECONDS = 10_000;

/**
 * A documentation address of its own for each client, so neither a retry nor
 * another run against the same stack finds a count this one left.
 */
const freshClientAddress = (): string =>
  `2001:db8:${randomInt(0x1_00_00).toString(16)}::${randomInt(0x1_00_00).toString(16)}`;

/**
 * Ask for the search page as `client`, straight from web-storefront: the edge
 * in front of the suite limits the page itself, and would refuse the burst
 * before the app saw it. The suite connects from loopback, which the app
 * trusts, so the `X-Forwarded-For` and `X-Forwarded-Host` sent here stand for
 * an edge that names the reader and the seed tenant's host.
 */
const searchAs = async (
  request: APIRequestContext,
  client: string
): Promise<{ retryAfter: string | undefined; status: number }> => {
  const response = await request.get(
    `${WEB_STOREFRONT_INTERNAL_URL}/search?q=rate-limit`,
    {
      headers: {
        "x-forwarded-for": client,
        "x-forwarded-host": new URL(WEB_STOREFRONT_BASE_URL).host,
      },
      maxRedirects: 0,
    }
  );

  return {
    retryAfter: response.headers()["retry-after"],
    status: response.status(),
  };
};

/**
 * Wait for a window of the count to begin, so the whole burst lands in one
 * window rather than being split across two that each admit it.
 */
const waitForWindowStart = async (): Promise<void> => {
  const intoWindow =
    Temporal.Now.instant().epochMilliseconds % WINDOW_MILLISECONDS;

  await setTimeout(WINDOW_MILLISECONDS - intoWindow);
};

test.describe("storefront search page rate limit", () => {
  test("refuses one client's burst past the limit and still serves another", async ({
    request,
  }) => {
    const client = freshClientAddress();
    const other = freshClientAddress();

    await waitForWindowStart();

    const burst = await Promise.all(
      Array.from({ length: SEARCH_PAGE_LIMIT + 10 }, () =>
        searchAs(request, client)
      )
    );

    const refused = burst.filter(({ status }) => status === 429);

    expect(burst.filter(({ status }) => status === 200)).toHaveLength(
      SEARCH_PAGE_LIMIT
    );
    expect(refused).toHaveLength(10);
    expect(Number(refused[0]?.retryAfter)).toBeGreaterThan(0);
    expect(Number(refused[0]?.retryAfter)).toBeLessThanOrEqual(10);

    const served = await searchAs(request, other);

    expect(served.status).toBe(200);
  });
});
