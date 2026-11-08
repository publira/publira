/**
 * The findings of `osv-scanner --format json` over the lock files, held to a
 * severity and to the findings a maintainer has accepted.
 * `scripts/check-dependency-vulns.sh` runs osv-scanner over `pnpm-lock.yaml`
 * and `mobile/pubspec.lock` and passes its output here; the
 * `Scan / Dependencies` job runs that script.
 *
 *     node scripts/dependency-vulns.ts osv-scanner.toml head.json
 *     node scripts/dependency-vulns.ts osv-scanner.toml head.json --base base.json
 *
 * A finding is one advisory against one version of one package. It fails the
 * run when its severity is high or critical: a CVSS score of 7.0 or more, or,
 * for an advisory that carries no score, a GitHub rating of `HIGH` or
 * `CRITICAL`. An advisory that carries neither cannot be shown to be below
 * that, so it fails as well. Every other finding is reported and passes.
 *
 * The run also fails on an entry whose `ignoreUntil` date has passed, whether
 * or not the finding is still there, and on an ignore file that does not hold
 * to its shape. An entry no finding needs any more is a warning: the
 * vulnerability is gone, and the entry is left to delete.
 *
 * With `--base`, the osv-scanner output for the lock files of the commit the
 * change goes onto, a finding fails only when the base does not carry it too:
 * the change is held to what it brings, and an advisory published against a
 * package that already merged is a warning there rather than a failure of
 * every unrelated change to a lock file until someone deals with it.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { parse } from "smol-toml";
import type { TomlValue } from "smol-toml";

import { isJsonObject, isJsonString } from "./json-value.ts";
import type { JsonObject, JsonValue } from "./json-value.ts";

/** One advisory against one version of one package. */
export interface Finding {
  /** The advisory's IDs and their aliases, any of which an entry may name. */
  readonly aliases: readonly string[];
  readonly ecosystem: string;
  /** The versions that fix it, empty when none does yet. */
  readonly fixedVersions: readonly string[];
  /** The ID osv-scanner groups the advisory under, as `GHSA-…`. */
  readonly id: string;
  /** The lock file the package is in, relative to the working directory. */
  readonly lockfile: string;
  readonly packageName: string;
  /** GitHub's rating, `LOW` to `CRITICAL`, when the advisory carries one. */
  readonly rating: string | undefined;
  /** The highest CVSS base score of the advisory, when it carries one. */
  readonly score: number | undefined;
  readonly summary: string;
  readonly version: string;
}

/** One accepted finding in the ignore file. */
export interface IgnoreEntry {
  /** The last day the entry suppresses the finding, in UTC. */
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
  /** The findings below the severity the run fails on. */
  readonly below: readonly Finding[];
  readonly errors: readonly Problem[];
  /** The findings an unexpired entry suppresses. */
  readonly ignored: readonly Finding[];
  readonly warnings: readonly Problem[];
}

/** The CVSS base score from which a finding fails the run. */
export const FAILING_SCORE = 7;

const FAILING_RATINGS = new Set(["CRITICAL", "HIGH"]);

const RATING_ORDER = ["LOW", "MODERATE", "HIGH", "CRITICAL"];

const stringField = (object: JsonObject, key: string): string | undefined => {
  const value = object[key];

  return isJsonString(value) && value !== "" ? value : undefined;
};

const objects = (value: JsonValue | undefined): JsonObject[] =>
  Array.isArray(value) ? value.filter(isJsonObject) : [];

const strings = (value: JsonValue | undefined): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => isJsonString(item) && item !== "")
    : [];

/** The `fixed` events of the advisory's ranges for the package. */
const fixedVersionsOf = (
  vulnerability: JsonObject,
  ecosystem: string,
  name: string
): string[] =>
  objects(vulnerability.affected)
    .filter((affected) => {
      const pkg = affected.package;

      return (
        isJsonObject(pkg) &&
        stringField(pkg, "ecosystem") === ecosystem &&
        stringField(pkg, "name") === name
      );
    })
    .flatMap((affected) => objects(affected.ranges))
    .flatMap((range) => objects(range.events))
    .map((event) => stringField(event, "fixed"))
    .filter((fixed): fixed is string => fixed !== undefined);

/** The highest of GitHub's ratings among the advisories, if any carries one. */
const highestRating = (vulnerabilities: readonly JsonObject[]) => {
  let highest: string | undefined;

  for (const vulnerability of vulnerabilities) {
    const specific = vulnerability.database_specific;

    const rating = isJsonObject(specific)
      ? stringField(specific, "severity")?.toUpperCase()
      : undefined;

    if (
      rating !== undefined &&
      (highest === undefined ||
        RATING_ORDER.indexOf(rating) > RATING_ORDER.indexOf(highest))
    ) {
      highest = rating;
    }
  }

  return highest;
};

const readScore = (value: string | undefined): number | undefined => {
  const score = value === undefined ? Number.NaN : Number(value);

  return Number.isFinite(score) ? score : undefined;
};

/**
 * The findings of osv-scanner's JSON output: one per group of advisories
 * osv-scanner reports against a package version, which joins the advisories
 * that are aliases of each other.
 */
export const readFindings = (output: JsonValue, cwd: string): Finding[] => {
  if (!isJsonObject(output) || !Array.isArray(output.results)) {
    throw new Error(
      "no `results` array: this is not the output of osv-scanner --format json"
    );
  }

  const findings: Finding[] = [];

  for (const result of objects(output.results)) {
    const { source } = result;

    const sourcePath = isJsonObject(source)
      ? stringField(source, "path")
      : undefined;

    const lockfile =
      sourcePath === undefined ? "" : path.relative(cwd, sourcePath);

    for (const entry of objects(result.packages)) {
      const pkg = entry.package;

      if (!isJsonObject(pkg)) {
        continue;
      }

      const ecosystem = stringField(pkg, "ecosystem") ?? "";
      const packageName = stringField(pkg, "name") ?? "";
      const version = stringField(pkg, "version") ?? "";
      const vulnerabilities = objects(entry.vulnerabilities);

      for (const group of objects(entry.groups)) {
        const ids = strings(group.ids);
        const aliases = [...new Set([...ids, ...strings(group.aliases)])];
        const [id] = ids;

        if (id === undefined) {
          continue;
        }

        const advisories = vulnerabilities.filter((vulnerability) => {
          const vulnerabilityId = stringField(vulnerability, "id");

          return vulnerabilityId !== undefined && ids.includes(vulnerabilityId);
        });

        const summary =
          advisories
            .map((advisory) => stringField(advisory, "summary"))
            .find((text) => text !== undefined) ?? "";

        const fixedVersions = [
          ...new Set(
            advisories.flatMap((advisory) =>
              fixedVersionsOf(advisory, ecosystem, packageName)
            )
          ),
        ];

        findings.push({
          aliases,
          ecosystem,
          fixedVersions,
          id,
          lockfile,
          packageName,
          rating: highestRating(advisories),
          score: readScore(stringField(group, "max_severity")),
          summary,
          version,
        });
      }
    }
  }

  return findings;
};

/** Whether the finding's severity is one the run fails on. */
export const fails = (finding: Finding): boolean => {
  if (finding.score !== undefined) {
    return finding.score >= FAILING_SCORE;
  }

  return finding.rating === undefined || FAILING_RATINGS.has(finding.rating);
};

/** What the ignore file holds, or the problems that keep it from being read. */
export interface IgnoreFile {
  readonly entries: readonly IgnoreEntry[];
  readonly problems: readonly Problem[];
}

const ADVISORY_ID = /^[A-Z][A-Z0-9]*-[A-Za-z0-9-]+$/u;

const ENTRY_KEYS = new Set(["id", "ignoreUntil", "reason"]);

const isTable = (
  value: TomlValue | undefined
): value is Record<string, TomlValue> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  // smol-toml builds a table without a prototype; a date is a Temporal
  // object.
  Object.getPrototypeOf(value) === null;

const isText = (value: TomlValue | undefined): value is string =>
  typeof value === "string";

const tomlString = (value: TomlValue | undefined): string | undefined =>
  isText(value) && value.trim() !== "" ? value.trim() : undefined;

interface EntryReading {
  readonly entry?: IgnoreEntry;
  readonly messages: readonly string[];
}

/**
 * One `[[IgnoredVulns]]` table, or the problems with it: `label` names it in a
 * message when it has no usable `id`, and `seen` holds the IDs before it.
 */
const readEntry = (
  value: TomlValue,
  label: string,
  seen: ReadonlySet<string>
): EntryReading => {
  if (!isTable(value)) {
    return { messages: [`${label} is not a table`] };
  }

  const id = tomlString(value.id);
  const reason = tomlString(value.reason);
  const until = value.ignoreUntil;
  const expires = until instanceof Temporal.PlainDate ? until : undefined;
  const name = id ?? label;
  const messages: string[] = [];

  if (id === undefined || !ADVISORY_ID.test(id)) {
    messages.push(
      `${label} needs an \`id\` naming the advisory, as GHSA-xxxx-xxxx-xxxx or CVE-YYYY-NNNN`
    );
  } else if (seen.has(id)) {
    messages.push(`${id} is listed twice`);
  }

  if (reason === undefined) {
    messages.push(`${name} needs a \`reason\` saying why it is accepted`);
  }

  if (expires === undefined) {
    messages.push(
      `${name} needs an \`ignoreUntil\` date, written as a bare TOML date: ignoreUntil = YYYY-MM-DD`
    );
  }

  for (const key of Object.keys(value)) {
    if (!ENTRY_KEYS.has(key)) {
      messages.push(`${name} has \`${key}\`, which an entry does not take`);
    }
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
 * The entries of the ignore file, an osv-scanner configuration that holds
 * nothing but `[[IgnoredVulns]]` tables, each with an advisory `id`, a
 * `reason`, and an `ignoreUntil` date. Any other key would change what a run
 * of osv-scanner with this file reports, and the scan does not apply it, so
 * it is refused rather than silently left out.
 */
export const readIgnoreFile = (source: string, file: string): IgnoreFile => {
  let parsed: Record<string, TomlValue>;

  try {
    parsed = parse(source, {
      unsafeKeyBehaviour: "throw",
      useLegacyDate: false,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    return {
      entries: [],
      problems: [{ file, message: `not TOML: ${reason}` }],
    };
  }

  const problems: Problem[] = [];

  for (const key of Object.keys(parsed)) {
    if (key !== "IgnoredVulns") {
      problems.push({
        file,
        message: `\`${key}\` is not read by the scan: the file holds only [[IgnoredVulns]] entries`,
      });
    }
  }

  const list = parsed.IgnoredVulns ?? [];

  if (!Array.isArray(list)) {
    problems.push({
      file,
      message: "`IgnoredVulns` must be an array of tables, [[IgnoredVulns]]",
    });

    return { entries: [], problems };
  }

  const entries: IgnoreEntry[] = [];
  const seen = new Set<string>();

  for (const [index, value] of list.entries()) {
    const { entry, messages } = readEntry(value, `entry ${index + 1}`, seen);

    if (entry !== undefined) {
      entries.push(entry);
    }

    for (const message of messages) {
      problems.push({ file, message });
    }

    const id = isTable(value) ? tomlString(value.id) : undefined;

    if (id !== undefined) {
      seen.add(id);
    }
  }

  return { entries, problems };
};

const describeSeverity = (finding: Finding): string => {
  if (finding.score !== undefined) {
    return `CVSS ${finding.score.toFixed(1)}`;
  }

  return finding.rating ?? "no severity given";
};

export const describe = (finding: Finding): string => {
  const fix =
    finding.fixedVersions.length === 0
      ? "no fixed version yet"
      : `fixed in ${finding.fixedVersions.join(", ")}`;

  const summary = finding.summary === "" ? "" : `: ${finding.summary}`;

  return `${finding.id}${summary} (${finding.packageName}@${finding.version} in ${finding.lockfile}, ${describeSeverity(finding)}, ${fix}; https://osv.dev/vulnerability/${finding.id})`;
};

/** How a finding is matched to the base: the package and the advisory. */
const baseKeys = (finding: Finding): string[] =>
  finding.aliases.map(
    (alias) => `${finding.ecosystem}\u0000${finding.packageName}\u0000${alias}`
  );

export interface EvaluateOptions {
  /**
   * The findings of the base, when the run checks a change; `undefined` holds
   * every finding to the ignore file.
   */
  readonly base?: readonly Finding[];
  /** The ignore file, named in its problems. */
  readonly file: string;
  readonly today: Temporal.PlainDate;
}

/**
 * The findings held to the severity and to the ignore file's entries on
 * `today`. An entry suppresses its finding through the day it expires; from
 * the day after, it is an error whether or not the finding is still there.
 * A finding the base carries too, matched by package and advisory whatever
 * version either side resolves, is a warning.
 */
export const evaluate = (
  findings: readonly Finding[],
  entries: readonly IgnoreEntry[],
  { base, file, today }: EvaluateOptions
): Report => {
  const errors: Problem[] = [];
  const warnings: Problem[] = [];
  const ignored: Finding[] = [];
  const below: Finding[] = [];
  const carried = new Set(base?.flatMap(baseKeys));
  const found = new Set(findings.flatMap(({ aliases }) => aliases));

  const entryFor = (finding: Finding) =>
    entries.find(({ id }) => finding.aliases.includes(id));

  for (const entry of entries) {
    if (Temporal.PlainDate.compare(entry.expires, today) < 0) {
      errors.push({
        file,
        message: `${entry.id} expired on ${entry.expires}: fix it, or judge it again and set a new date. Accepted because: ${entry.reason}`,
      });
    } else if (!found.has(entry.id)) {
      warnings.push({
        file,
        message: `${entry.id} is no longer found; delete its entry`,
      });
    }
  }

  for (const finding of findings) {
    const entry = entryFor(finding);

    if (entry !== undefined) {
      if (Temporal.PlainDate.compare(entry.expires, today) >= 0) {
        ignored.push(finding);
      }
    } else if (!fails(finding)) {
      below.push(finding);
    } else if (baseKeys(finding).some((key) => carried.has(key))) {
      warnings.push({
        message: `${describe(finding)}. The base carries it too, so this change did not bring it: fix or accept it in a change of its own`,
      });
    } else {
      errors.push({ message: describe(finding) });
    }
  }

  return { below, errors, ignored, warnings };
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

const readOutput = (file: string, cwd: string): Finding[] =>
  readFindings(JSON.parse(readFileSync(file, "utf-8")), cwd);

if (import.meta.main) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { base: { type: "string" } },
  });

  const [file, head] = positionals;

  if (file === undefined || head === undefined || positionals.length > 2) {
    console.error(
      "usage: node scripts/dependency-vulns.ts <ignore-file> <osv-scanner.json> [--base <base osv-scanner.json>]"
    );
    process.exit(2);
  }

  const findings = readOutput(head, process.cwd());

  const base =
    values.base === undefined
      ? undefined
      : readOutput(values.base, process.cwd());

  const { entries, problems } = readIgnoreFile(
    readFileSync(file, "utf-8"),
    file
  );

  const report = evaluate(findings, entries, {
    base,
    file,
    today: Temporal.Now.plainDateISO("UTC"),
  });

  for (const finding of report.below) {
    console.log(`below high: ${describe(finding)}`);
  }

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
    const scope = base === undefined ? "" : " that the base does not carry";

    console.log(
      `osv-scanner: no high or critical finding${scope} outside ${file} (${findings.length} found, ${report.below.length} below high, ${report.ignored.length} ignored)`
    );
  }
}
