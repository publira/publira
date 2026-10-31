import { expect, test } from "@playwright/test";

import { unexpectedServerLogLines } from "../src/server-log";

/**
 * The errors a passing run provokes on purpose. `storefront.auth.spec.ts` and
 * the console auth suites present a rejected session, and a reader redirected
 * or navigated away mid-stream closes the response React is still rendering
 * into.
 *
 * A reader can also close a request before the server has read it. After every
 * client-side navigation the site asks again whether a signed-in reader owes an
 * agreement, through a Server Action nothing on the page waits for, so a reader
 * who moves on or closes the page straight after one — a spec ending on the
 * announcement list it just paged through, for one — leaves its body unread,
 * and Next.js reports the connection reset as `aborted`. It reports it without
 * the `⨯` prefix when the reset lands while `proxy.ts` holds the request:
 * Next.js copies the body of every request the proxy sees and waits for the
 * rest of it before rendering, and when that wait fails it logs the error
 * itself through `console.error`, outside the request boundary.
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
  /^⨯ Error: aborted$/u,
  /^Error: aborted$/u,
  /^\[web-storefront\] \w+ failed Error \[ConnectError\]: \[unavailable\] connect ECONNREFUSED \S+$/u,
];

/**
 * What a stack that traces (`task e2e:tracing`) adds when the apps run under
 * `next dev` (`PUBLIRA_E2E_WEB_MODE=dev`): Next.js warns about the root span of
 * a cold render whose metadata it resolved first (vercel/next.js#91831). A
 * production build does not print it, and neither does a stack that traces
 * nothing, so there it stays a line this check refuses.
 */
const EXPECTED_WHILE_TRACING_UNDER_NEXT_DEV = [
  /^Unexpected root span type 'ResolveMetadata\.generateMetadata'\. Please report this Next\.js issue https:\/\/github\.com\/vercel\/next\.js$/u,
];

const tracingUnderNextDev =
  process.env.PUBLIRA_E2E_TRACING === "on" &&
  process.env.PUBLIRA_E2E_WEB_MODE === "dev";

test.describe("web-storefront server log", () => {
  test("carries only the lines a passing run leaves", async () => {
    expect(
      await unexpectedServerLogLines("web-storefront", [
        ...EXPECTED_ERRORS,
        ...(tracingUnderNextDev ? EXPECTED_WHILE_TRACING_UNDER_NEXT_DEV : []),
      ])
    ).toEqual([]);
  });
});
