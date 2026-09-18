import { expect, test } from "@playwright/test";

import { unexpectedServerLogLines } from "../src/server-log";

/**
 * The errors a passing run provokes on purpose.
 * `platform.error-boundary.spec.ts` renders the console while the API is down,
 * and an operator navigated away mid-stream closes the response React is still
 * rendering into.
 */
const EXPECTED_ERRORS = [
  /^⨯ Error \[ConnectError\]: \[unavailable\] connect ECONNREFUSED \S+$/u,
  /^⨯ Error: The destination stream closed early\.$/u,
];

test.describe("web-platform server log", () => {
  test("carries only the lines a passing run leaves", async () => {
    expect(
      await unexpectedServerLogLines("web-platform", EXPECTED_ERRORS)
    ).toEqual([]);
  });
});
