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

/** A line that belongs to the entry above it rather than opening one. */
const ENTRY_CONTINUATION = /^(?:\s|\}$)/u;

/**
 * The `digest` of the error an entry inspects. A nested object, such as a
 * `cause`, indents its own properties further, so only the entry's own
 * property sits two spaces in.
 */
const ENTRY_DIGEST = /^ {2}digest: '(?<digest>[^']+)'$/u;

const entryDigest = (
  lines: readonly string[],
  header: number
): string | undefined => {
  const rest = lines.slice(header + 1);
  const end = rest.findIndex((line) => !ENTRY_CONTINUATION.test(line));
  for (const line of end === -1 ? rest : rest.slice(0, end)) {
    const digest = ENTRY_DIGEST.exec(line)?.groups?.digest;
    if (digest) {
      return digest;
    }
  }
  return undefined;
};

/**
 * The lines of a Next.js app's log under `e2e/.run/logs/` that are neither
 * ordinary Next.js output nor one of `expectedErrors`, the errors a passing
 * run provokes on purpose. The whole run's log is read rather than a spec's
 * own responses, because which request such an error lands on is not fixed.
 *
 * A line that opens an error entry carries that entry's `digest` with it. A
 * production build omits the message of an error that crossed a Server
 * Components boundary, so the digest is often all that identifies it, and it
 * is the "Error ID" the error screen showed: the failing spec whose
 * `error-context.md` records the same ID is the one that rendered it.
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
  const lines = log.split("\n");
  return lines.flatMap((line, index) => {
    if (allowed.some((pattern) => pattern.test(line))) {
      return [];
    }
    const digest = entryDigest(lines, index);
    return [digest ? `${line} (digest ${digest})` : line];
  });
};
