import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

/**
 * What web-host wrote while the suite ran. `start-apps.sh` truncates the file
 * as it starts the process, so it holds the whole run and nothing else.
 *
 * Next.js marks an unhandled server error with `⨯`, and an unhandled error in a
 * request is a bare 500 the reader sees. Which request it lands on is not
 * fixed, so a suite that only asserts its own responses reports such a defect
 * as an unrelated test failing on an unrelated branch — or misses it entirely.
 * This project runs after every other one and reads the log instead.
 */
const ERROR_MARKER = "⨯";

/**
 * The one error a passing run is expected to leave. `host.auth.spec.ts` and the
 * console auth suites present a rejected session on purpose, and web-host
 * reports the refusal its RPC client raised for it.
 */
const EXPECTED_ERRORS = [/\[unauthenticated\] invalid token/u];

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
