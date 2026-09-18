import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Next.js prefixes every line it prints on purpose, so a line that carries no
 * prefix reached the log through `console.error` — an error reported outside
 * the request boundary, where the `⨯` marker never appears.
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
 * The lines of a Next.js app's log under `e2e/.run/logs/` that are neither
 * ordinary Next.js output nor one of `expectedErrors`, the errors a passing
 * run provokes on purpose. The whole run's log is read rather than a spec's
 * own responses, because which request such an error lands on is not fixed.
 */
export const unexpectedServerLogLines = async (
  app: "web-admin" | "web-host" | "web-platform",
  expectedErrors: readonly RegExp[]
): Promise<string[]> => {
  const runDir = process.env.PUBLIRA_E2E_RUN_DIR;
  if (!runDir) {
    throw new Error(
      "PUBLIRA_E2E_RUN_DIR is unset: run the suite through `task e2e:test`, which sources e2e/scripts/lib.sh"
    );
  }

  const log = await readFile(path.join(runDir, "logs", `${app}.log`), "utf-8");
  const allowed = [...ALLOWED_OUTPUT, ...expectedErrors];
  return log
    .split("\n")
    .filter((line) => !allowed.some((pattern) => pattern.test(line)));
};
