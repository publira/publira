import { expect, test } from "@playwright/test";

import { unexpectedServerLogLines } from "../src/server-log";

/**
 * The errors a passing run provokes on purpose. `admin.error-boundary.spec.ts`
 * renders the console while the API is down, where a request finds nothing
 * listening: one the GOAWAY of the stopping API refused is sent again and
 * finds the same. It fails a render, or the public tenant read, which says so
 * and renders the console without the tenant's name and theme. An operator
 * navigated away mid-stream closes the response React is still rendering into.
 */
const EXPECTED_ERRORS = [
  /^⨯ Error \[ConnectError\]: \[unavailable\] connect ECONNREFUSED \S+$/u,
  /^\[web-admin\] getTenantPublicInfo failed Error \[ConnectError\]: \[unavailable\] connect ECONNREFUSED \S+$/u,
  /^⨯ Error: The destination stream closed early\.$/u,
];

test.describe("web-admin server log", () => {
  test("carries only the lines a passing run leaves", async () => {
    expect(
      await unexpectedServerLogLines("web-admin", EXPECTED_ERRORS)
    ).toEqual([]);
  });
});
