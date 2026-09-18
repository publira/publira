import { expect, test } from "@playwright/test";

import { unexpectedServerLogLines } from "../src/server-log";

/**
 * The errors a passing run provokes on purpose. `host.auth.spec.ts` and the
 * console auth suites present a rejected session, and a reader redirected or
 * navigated away mid-stream closes the response React is still rendering into.
 */
const EXPECTED_ERRORS = [
  /^⨯ Error \[ConnectError\]: \[unauthenticated\] invalid token$/u,
  /^⨯ Error: The destination stream closed early\.$/u,
];

test.describe("web-host server log", () => {
  test("carries only the lines a passing run leaves", async () => {
    expect(await unexpectedServerLogLines("web-host", EXPECTED_ERRORS)).toEqual(
      []
    );
  });
});
