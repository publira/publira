import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

/**
 * Next.js marks an unhandled server error with `⨯`, and in a request that error
 * is a bare 500 the reader sees. Which request it lands on is not fixed, so this
 * suite reads the whole run's log instead of asserting on its own responses.
 */
const ERROR_MARKER = "⨯";

/**
 * The errors a passing run is expected to leave. `host.auth.spec.ts` and the
 * console auth suites present a rejected session on purpose, and a reader
 * redirected or navigated away mid-stream closes the response React is still
 * rendering into — a render cancelled by the client, which Next.js reports with
 * the same marker as an error that went unanswered.
 */
const EXPECTED_ERRORS = [
  /\[unauthenticated\] invalid token/u,
  /The destination stream closed early\./u,
];

test.describe("web-host server log", () => {
  test("carries no unhandled error", async () => {
    const runDir = process.env.E2E_RUN_DIR;
    if (!runDir) {
      throw new Error(
        "E2E_RUN_DIR is unset: run the suite through `task e2e:test`, which sources e2e/scripts/lib.sh"
      );
    }

    const log = await readFile(
      path.join(runDir, "logs", "web-host.log"),
      "utf-8"
    );
    const unexpected = log
      .split("\n")
      .filter(
        (line) =>
          line.includes(ERROR_MARKER) &&
          !EXPECTED_ERRORS.some((expected) => expected.test(line))
      );

    expect(unexpected).toEqual([]);
  });
});
