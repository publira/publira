import { expect, test } from "@playwright/test";

import { unexpectedServerLogLines } from "../src/server-log";

/**
 * The errors a passing run provokes on purpose. `host.auth.spec.ts` and the
 * console auth suites present a rejected session, and a reader redirected or
 * navigated away mid-stream closes the response React is still rendering into.
 *
 * `catalog.outage.spec.ts` renders the site while the API is down, and any
 * cached site-chrome read whose entry is missing or stale at that moment
 * reports that it could not ask: it finds nothing listening, and so does a
 * read the GOAWAY of the stopping API refused, which is sent again. Which
 * reads that is depends on what the run happened to cache and revalidate
 * beforehand, so the pattern names the shape of the warning rather than a
 * read. Any other failure of those reads still reaches this check.
 */
const EXPECTED_ERRORS = [
  /^⨯ Error \[ConnectError\]: \[unauthenticated\] invalid token$/u,
  /^⨯ Error: The destination stream closed early\.$/u,
  /^\[web-host\] \w+ failed Error \[ConnectError\]: \[unavailable\] connect ECONNREFUSED \S+$/u,
];

test.describe("web-host server log", () => {
  test("carries only the lines a passing run leaves", async () => {
    expect(await unexpectedServerLogLines("web-host", EXPECTED_ERRORS)).toEqual(
      []
    );
  });
});
