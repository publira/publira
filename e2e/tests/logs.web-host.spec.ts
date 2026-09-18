import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

/**
 * Next.js prefixes every line it prints on purpose, so a line that carries no
 * prefix reached the log through `console.error` — an error reported outside
 * the request boundary, where the `⨯` marker never appears. This suite reads
 * the whole run's log rather than asserting on its own responses, because which
 * request such an error lands on is not fixed.
 */
const ALLOWED_OUTPUT = [
  // The empty line the file's trailing newline leaves.
  /^$/u,
  // A stack frame, an inspected property, or a `next dev` request line, each
  // indented under the line it belongs to.
  /^\s/u,
  // The close of an error object Next.js inspected across several lines.
  /^\}$/u,
  // The startup banner and the details listed under it.
  /^▲ Next\.js /u,
  /^- /u,
  // The prefixes Next.js gives output that is not an error: done, pending,
  // warning, trace.
  /^[✓○⚠»] /u,
];

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
    const runDir = process.env.PUBLIRA_E2E_RUN_DIR;
    if (!runDir) {
      throw new Error(
        "PUBLIRA_E2E_RUN_DIR is unset: run the suite through `task e2e:test`, which sources e2e/scripts/lib.sh"
      );
    }

    const log = await readFile(
      path.join(runDir, "logs", "web-host.log"),
      "utf-8"
    );
    const allowed = [...ALLOWED_OUTPUT, ...EXPECTED_ERRORS];
    const unexpected = log
      .split("\n")
      .filter((line) => !allowed.some((pattern) => pattern.test(line)));

    expect(unexpected).toEqual([]);
  });
});
