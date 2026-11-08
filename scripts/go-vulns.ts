/**
 * The findings of `govulncheck -format json`, held to the findings a
 * maintainer has accepted. `scripts/check-go-vulns.sh` runs govulncheck over
 * `server/` and pipes its output here; the `Scan / Go` job runs that script.
 *
 *     node scripts/go-vulns.ts server/govulncheck-ignore.json < govulncheck.json
 *     node scripts/go-vulns.ts server/govulncheck-ignore.json --base base.json < govulncheck.json
 *
 * govulncheck reports a vulnerability at three levels: the module is required,
 * a package of it is imported, a vulnerable symbol is reached. Only the last
 * is a call the binaries can make, and only the last makes govulncheck's own
 * text mode exit non-zero, so only the last is a finding here.
 *
 * The run fails on a finding the ignore file does not list, on an entry whose
 * expiry has passed, and on an ignore file that does not hold to its shape.
 * An entry no finding needs any more is a warning: the vulnerability is gone,
 * and the entry is left to delete.
 *
 * With `--base`, the govulncheck output of the branch a pull request merges
 * into, an unlisted finding fails only when the base does not reach it too:
 * the pull request is held to what it brings, and an advisory published
 * against code that already merged is a warning there rather than a failure
 * of every unrelated pull request until someone deals with it.
 */

import { readFileSync } from "node:fs";
import { text } from "node:stream/consumers";
import { parseArgs } from "node:util";

import { isJsonObject, isJsonString } from "./json-value.ts";
import type { JsonObject, JsonValue } from "./json-value.ts";

/** One reachable vulnerability, by advisory. */
export interface Finding {
  /** The calls from the server's code down to the vulnerable symbol, outermost first. */
  readonly callStack: readonly string[];
  /** The version that fixes it, or `undefined` when none does yet. */
  readonly fixedVersion: string | undefined;
  /** The Go vulnerability database ID, `GO-YYYY-NNNN`. */
  readonly id: string;
  /** The module the vulnerable symbol is in; `stdlib` for the standard library. */
  readonly module: string;
  readonly summary: string;
  /** The version of `module` the build selects. */
  readonly version: string;
}

/** One accepted finding in the ignore file. */
export interface IgnoreEntry {
  /** The last day the entry suppresses the finding, `YYYY-MM-DD` in UTC. */
  readonly expires: Temporal.PlainDate;
  readonly id: string;
  /** Why the finding is accepted, and what lifts it. */
  readonly reason: string;
}

export interface Problem {
  /** The file the problem is in, when it is in the ignore file. */
  readonly file?: string;
  readonly message: string;
}

export interface Report {
  readonly errors: readonly Problem[];
  /** The findings an unexpired entry suppresses. */
  readonly ignored: readonly Finding[];
  readonly warnings: readonly Problem[];
}

const ADVISORY_ID = /^GO-\d{4}-\d{4,}$/u;

/**
 * The JSON values of a stream that concatenates them, as govulncheck writes
 * its messages: each one an indented object, with nothing between them but
 * whitespace.
 */
export const splitJsonStream = (stream: string): JsonValue[] => {
  const values: JsonValue[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = -1;

  for (let index = 0; index < stream.length; index += 1) {
    const char = stream[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
    } else if (char === '"') {
      inString = true;
    } else if (char === "{" || char === "[") {
      if (depth === 0) {
        start = index;
      }

      depth += 1;
    } else if (char === "}" || char === "]") {
      depth -= 1;

      if (depth === 0) {
        const value: JsonValue = JSON.parse(stream.slice(start, index + 1));

        values.push(value);
      } else if (depth < 0) {
        throw new Error(`unbalanced '${char}' at offset ${index}`);
      }
    } else if (depth === 0 && !/\s/u.test(char ?? "")) {
      throw new Error(`unexpected '${char}' at offset ${index}`);
    }
  }

  if (depth !== 0 || inString) {
    throw new Error("the output ends inside a message");
  }

  return values;
};

const stringField = (object: JsonObject, key: string): string | undefined => {
  const value = object[key];

  return isJsonString(value) && value !== "" ? value : undefined;
};

/** How a frame of a trace reads in Go: `pkg.(*Receiver).Function`. */
const frameName = (frame: JsonObject): string => {
  const pkg = stringField(frame, "package") ?? stringField(frame, "module");
  const fn = stringField(frame, "function") ?? "";
  const receiver = stringField(frame, "receiver");

  if (receiver === undefined) {
    return `${pkg}.${fn}`;
  }

  return receiver.startsWith("*")
    ? `${pkg}.(${receiver}).${fn}`
    : `${pkg}.${receiver}.${fn}`;
};

/**
 * The reachable findings of govulncheck's messages, one per advisory, with
 * the first trace govulncheck gives for it.
 */
export const readFindings = (messages: readonly JsonValue[]): Finding[] => {
  const summaries = new Map<string, string>();
  const findings = new Map<string, Finding>();
  let configured = false;

  for (const message of messages) {
    if (!isJsonObject(message)) {
      throw new Error("a message is not an object");
    }

    if (isJsonObject(message.config)) {
      configured = true;
    }

    const { osv } = message;

    if (isJsonObject(osv)) {
      const id = stringField(osv, "id");

      if (id !== undefined) {
        summaries.set(id, stringField(osv, "summary") ?? "");
      }
    }

    const { finding } = message;

    if (!isJsonObject(finding)) {
      continue;
    }

    const id = stringField(finding, "osv");
    const { trace } = finding;
    const frames = Array.isArray(trace) ? trace.filter(isJsonObject) : [];
    const [symbol] = frames;

    // A trace whose innermost frame names no function is the module or the
    // package level: required or imported, never called.
    if (
      id === undefined ||
      symbol === undefined ||
      stringField(symbol, "function") === undefined ||
      findings.has(id)
    ) {
      continue;
    }

    findings.set(id, {
      callStack: frames.toReversed().map(frameName),
      fixedVersion: stringField(finding, "fixed_version"),
      id,
      module: stringField(symbol, "module") ?? "",
      summary: "",
      version: stringField(symbol, "version") ?? "",
    });
  }

  if (!configured) {
    throw new Error(
      "no config message: this is not the output of govulncheck -format json"
    );
  }

  return [...findings.values()].map((finding) => ({
    ...finding,
    summary: summaries.get(finding.id) ?? "",
  }));
};

/** What the ignore file holds, or the problems that keep it from being read. */
export interface IgnoreFile {
  readonly entries: readonly IgnoreEntry[];
  readonly problems: readonly Problem[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/u;

/** `value` as a calendar date, or `undefined` when it is not one. */
const parseDate = (
  value: string | undefined
): Temporal.PlainDate | undefined => {
  if (value === undefined || !DATE.test(value)) {
    return undefined;
  }

  try {
    return Temporal.PlainDate.from(value, { overflow: "reject" });
  } catch {
    return undefined;
  }
};

interface EntryReading {
  readonly entry?: IgnoreEntry;
  readonly messages: readonly string[];
}

/**
 * One entry of the ignore file, or the problems with it: `label` names it in
 * a message when it has no usable `id`, and `seen` holds the ids before it.
 */
const readEntry = (
  value: JsonValue,
  label: string,
  seen: ReadonlySet<string>
): EntryReading => {
  if (!isJsonObject(value)) {
    return { messages: [`${label} is not an object`] };
  }

  const id = stringField(value, "id");
  const reason = stringField(value, "reason")?.trim();
  const expires = parseDate(stringField(value, "expires"));
  const name = id ?? label;
  const messages: string[] = [];

  if (id === undefined || !ADVISORY_ID.test(id)) {
    messages.push(`${label} needs an \`id\` of the form GO-YYYY-NNNN`);
  } else if (seen.has(id)) {
    messages.push(`${id} is listed twice`);
  }

  if (reason === undefined || reason === "") {
    messages.push(`${name} needs a \`reason\` saying why it is accepted`);
  }

  if (expires === undefined) {
    messages.push(`${name} needs an \`expires\` date, YYYY-MM-DD`);
  }

  if (
    messages.length > 0 ||
    id === undefined ||
    reason === undefined ||
    expires === undefined
  ) {
    return { messages };
  }

  return { entry: { expires, id, reason }, messages };
};

/**
 * The entries of the ignore file: an object whose `ignore` is an array of
 * entries, each with a Go advisory `id`, a `reason`, and an `expires` date.
 */
export const readIgnoreFile = (source: string, file: string): IgnoreFile => {
  let parsed: JsonValue;

  try {
    parsed = JSON.parse(source);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    return {
      entries: [],
      problems: [{ file, message: `not JSON: ${reason}` }],
    };
  }

  const list = isJsonObject(parsed) ? parsed.ignore : undefined;

  if (!Array.isArray(list)) {
    return {
      entries: [],
      problems: [
        { file, message: "expected an object with an `ignore` array" },
      ],
    };
  }

  const entries: IgnoreEntry[] = [];
  const problems: Problem[] = [];
  const seen = new Set<string>();

  for (const [index, value] of list.entries()) {
    const { entry, messages } = readEntry(value, `entry ${index + 1}`, seen);

    if (entry !== undefined) {
      entries.push(entry);
    }

    for (const message of messages) {
      problems.push({ file, message });
    }

    if (isJsonObject(value)) {
      const id = stringField(value, "id");

      if (id !== undefined) {
        seen.add(id);
      }
    }
  }

  return { entries, problems };
};

const describe = (finding: Finding): string => {
  const fix =
    finding.fixedVersion === undefined
      ? "no fixed version yet"
      : `fixed in ${finding.fixedVersion}`;

  const summary = finding.summary === "" ? "" : `: ${finding.summary}`;

  return `${finding.id}${summary} (${finding.module}@${finding.version}, ${fix}; https://pkg.go.dev/vuln/${finding.id})`;
};

export interface EvaluateOptions {
  /**
   * The IDs the base branch reaches, when the run checks a pull request;
   * `undefined` holds every finding to the ignore file.
   */
  readonly base?: ReadonlySet<string>;
  /** The ignore file, named in its problems. */
  readonly file: string;
  readonly today: Temporal.PlainDate;
}

/**
 * The findings held to the ignore file's entries on `today`. An entry
 * suppresses its finding through the day it expires; from the day after, it
 * is an error whether or not the finding is still there.
 */
export const evaluate = (
  findings: readonly Finding[],
  entries: readonly IgnoreEntry[],
  { base, file, today }: EvaluateOptions
): Report => {
  const errors: Problem[] = [];
  const warnings: Problem[] = [];
  const ignored: Finding[] = [];
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const found = new Set(findings.map(({ id }) => id));

  for (const entry of entries) {
    if (Temporal.PlainDate.compare(entry.expires, today) < 0) {
      errors.push({
        file,
        message: `${entry.id} expired on ${entry.expires}: fix it, or judge it again and set a new expiry. Accepted because: ${entry.reason}`,
      });
    } else if (!found.has(entry.id)) {
      warnings.push({
        file,
        message: `${entry.id} is no longer reached; delete its entry`,
      });
    }
  }

  for (const finding of findings) {
    const entry = byId.get(finding.id);

    if (entry === undefined) {
      const message = `${describe(finding)}, reached through ${finding.callStack.join(" → ")}`;

      if (base?.has(finding.id)) {
        warnings.push({
          message: `${message}. The base branch reaches it too, so this change did not bring it: fix or accept it in a change of its own`,
        });
      } else {
        errors.push({ message });
      }
    } else if (Temporal.PlainDate.compare(entry.expires, today) >= 0) {
      ignored.push(finding);
    }
  }

  return { errors, ignored, warnings };
};

const print = (level: "error" | "warning", problem: Problem): void => {
  if (process.env.GITHUB_ACTIONS) {
    const file = problem.file === undefined ? "" : ` file=${problem.file}`;

    console.error(`::${level}${file}::${problem.message}`);
  } else {
    const file = problem.file === undefined ? "" : `${problem.file}: `;

    console.error(`${level}: ${file}${problem.message}`);
  }
};

const readOutput = (source: string): Finding[] =>
  readFindings(splitJsonStream(source));

if (import.meta.main) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { base: { type: "string" } },
  });

  const [file] = positionals;

  if (file === undefined || positionals.length > 1) {
    console.error(
      "usage: node scripts/go-vulns.ts <ignore-file> [--base <base-output>] < govulncheck.json"
    );
    process.exit(2);
  }

  const findings = readOutput(await text(process.stdin));

  const base =
    values.base === undefined
      ? undefined
      : new Set(
          readOutput(readFileSync(values.base, "utf-8")).map(({ id }) => id)
        );

  const { entries, problems } = readIgnoreFile(
    readFileSync(file, "utf-8"),
    file
  );

  const report = evaluate(findings, entries, {
    base,
    file,
    today: Temporal.Now.plainDateISO("UTC"),
  });

  for (const finding of report.ignored) {
    console.log(`ignored: ${describe(finding)}`);
  }

  for (const warning of report.warnings) {
    print("warning", warning);
  }

  for (const error of [...problems, ...report.errors]) {
    print("error", error);
  }

  if (problems.length > 0 || report.errors.length > 0) {
    process.exitCode = 1;
  } else {
    const scope =
      base === undefined ? "" : " that the base branch does not reach";

    console.log(
      `govulncheck: no reachable vulnerability${scope} outside ${file} (${findings.length} reachable, ${report.ignored.length} ignored)`
    );
  }
}
