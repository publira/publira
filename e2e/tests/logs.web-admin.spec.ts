import { expect, test } from "@playwright/test";

import { unexpectedServerLogLines } from "../src/server-log";

/**
 * The errors a passing run provokes on purpose. `admin.error-boundary.spec.ts`
 * renders the console while the API is down: a request finds nothing listening,
 * or is refused by the GOAWAY the API sends while it shuts down. An operator
 * navigated away mid-stream closes the response React is still rendering into.
 */
const EXPECTED_ERRORS = [
  /^⨯ Error \[ConnectError\]: \[unavailable\] connect ECONNREFUSED \S+$/u,
  /^⨯ Error \[ConnectError\]: \[internal\] Stream closed with error code NGHTTP2_REFUSED_STREAM$/u,
  /^⨯ Error: The destination stream closed early\.$/u,
  // Not provoked on purpose: a Next.js 16.3 defect (vercel/next.js#96519). A
  // Server Action that lands on a page whose cached entry has gone stale
  // schedules a background revalidation with the action's own request, and
  // that render reads the already consumed body a second time. The action
  // itself succeeds, so the line is all a passing run shows of it, and whether
  // the suite reaches a stale entry depends on timing. Remove this pattern
  // once Next.js ships the fix: #3566.
  /^⨯ Error: Unexpected end of form$/u,
];

test.describe("web-admin server log", () => {
  test("carries only the lines a passing run leaves", async () => {
    expect(
      await unexpectedServerLogLines("web-admin", EXPECTED_ERRORS)
    ).toEqual([]);
  });
});
