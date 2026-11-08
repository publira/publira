/**
 * The Issue that Weekly scan keeps for what the scans of `main` find, built
 * from the reports the jobs of `.github/workflows/scan.yml` upload: a
 * directory per job named after its artifact, `scan-report-go` and
 * `scan-report-dependencies`, holding the script's `output` and its exit
 * `status`.
 *
 *     node scripts/scan-report.ts <report-dir> --commit <sha> --run <url>
 *
 * It prints a JSON object: `state`, `fingerprint`, and `body`, whose first
 * line is the marker that a run finds the Issue by, carrying the fingerprint
 * that tells it whether the findings changed. The state is
 * `findings` when any scan failed on what it found, `clean` when every scan
 * passed, and `incomplete` when a scan did not run to the end and none found
 * anything, so that a broken scan neither files nor closes the Issue. A
 * scan's findings are the `::error` annotations its script prints, which are
 * exactly what it fails on; a script that fails without one did not finish.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

/** The marker that starts the body of the Issue, and how a run finds it. */
export const MARKER = "publira-weekly-scan";

const README =
  "https://github.com/publira/publira/blob/main/.github/workflows/README.md";

interface Scan {
  readonly heading: string;
  /** The section of the workflows README that says how to handle a finding. */
  readonly handling: string;
  readonly job: string;
  readonly key: string;
}

export const SCANS: readonly Scan[] = [
  {
    handling: `${README}#handling-a-finding`,
    heading: "Go modules",
    job: "Scan / Go",
    key: "go",
  },
  {
    handling: `${README}#handling-a-dependency-finding`,
    heading: "npm and pub dependencies",
    job: "Scan / Dependencies",
    key: "dependencies",
  },
];

/** What one scan's job left: its output and the exit status of its script. */
export interface ScanReport {
  readonly output: string;
  readonly status: number;
}

export type ScanResult =
  | { readonly kind: "clean" }
  | { readonly kind: "findings"; readonly findings: readonly string[] }
  | { readonly kind: "incomplete" };

/** The values a workflow command escapes, decoded. */
const decodeCommandValue = (value: string): string =>
  value
    .replaceAll("%0D", "\r")
    .replaceAll("%0A", "\n")
    .replaceAll("%3A", ":")
    .replaceAll("%2C", ",")
    .replaceAll("%25", "%");

const ERROR = /^::error(?: (?<properties>[^:]*))?::(?<message>.*)$/u;

/**
 * The `::error` annotations of a script's output, each as it reads in the
 * Issue: the message, after the file it is about when it names one.
 */
export const readErrors = (output: string): string[] => {
  const errors: string[] = [];

  for (const line of output.split(/\r?\n/u)) {
    const groups = ERROR.exec(line)?.groups;

    if (groups === undefined) {
      continue;
    }

    const message = decodeCommandValue(groups.message ?? "");

    const file = (groups.properties ?? "")
      .split(",")
      .map((property) => property.split("="))
      .find(([name]) => name === "file")?.[1];

    errors.push(
      file === undefined
        ? message
        : `\`${decodeCommandValue(file)}\`: ${message}`
    );
  }

  return errors;
};

/** What a scan's report says, or `incomplete` when the job left none. */
export const readScan = (report: ScanReport | undefined): ScanResult => {
  if (report === undefined) {
    return { kind: "incomplete" };
  }

  if (report.status === 0) {
    return { kind: "clean" };
  }

  const findings = readErrors(report.output);

  return findings.length === 0
    ? { kind: "incomplete" }
    : { findings, kind: "findings" };
};

export interface Report {
  readonly body: string;
  /** A digest of what the scans found, the same for the same findings. */
  readonly fingerprint: string;
  readonly state: "clean" | "findings" | "incomplete";
}

/** GitHub refuses an Issue body longer than this. */
const BODY_LIMIT = 65_536;

const section = (
  scan: Scan,
  result: ScanResult,
  runUrl: string,
  limit: number
): string => {
  if (result.kind === "clean") {
    return `## ${scan.heading}\n\nNothing found.`;
  }

  if (result.kind === "incomplete") {
    return `## ${scan.heading}\n\n\`${scan.job}\` did not finish; see [the run](${runUrl}).`;
  }

  const shown = result.findings.slice(0, limit);
  const rest = result.findings.length - shown.length;
  const more = rest > 0 ? `\n- …and ${rest} more in [the run](${runUrl}).` : "";

  const list = shown.map((finding) => `- ${finding}`).join("\n");

  return `## ${scan.heading}\n\nHandle each one as [the workflows README](${scan.handling}) describes.\n\n${list}${more}`;
};

export interface BuildOptions {
  readonly commit: string;
  readonly runUrl: string;
}

/**
 * The Issue for the scans' results: its state, the fingerprint of what they
 * found, and its body.
 */
export const buildReport = (
  results: ReadonlyMap<string, ScanResult>,
  { commit, runUrl }: BuildOptions
): Report => {
  const scans = SCANS.map((scan) => ({
    result: results.get(scan.key) ?? { kind: "incomplete" as const },
    scan,
  }));

  const kinds = new Set(scans.map(({ result }) => result.kind));
  let state: Report["state"] = "incomplete";

  if (kinds.has("findings")) {
    state = "findings";
  } else if (kinds.size === 1 && kinds.has("clean")) {
    state = "clean";
  }

  const fingerprint = createHash("sha256")
    .update(
      scans
        .flatMap(({ result, scan }) =>
          result.kind === "findings"
            ? result.findings.map((finding) => `${scan.key}\t${finding}`)
            : [`${scan.key}\t${result.kind}`]
        )
        .toSorted()
        .join("\n")
    )
    .digest("hex")
    .slice(0, 16);

  const render = (limit: number): string =>
    [
      `<!-- ${MARKER} fingerprint=${fingerprint} -->`,
      `The weekly scan of \`main\` found what the \`Scan / *\` jobs of \`CI\` would fail on with no base to compare against: a vulnerability that the ignore file does not accept, or an entry of it that has expired. Fix each finding or accept it in a pull request of its own. Every run updates this Issue, comments when what it finds changes, and closes it once it finds nothing.`,
      ...scans.map(({ result, scan }) => section(scan, result, runUrl, limit)),
      `Scanned \`${commit}\` in [this run](${runUrl}).`,
    ].join("\n\n");

  let limit = Number.POSITIVE_INFINITY;
  let body = render(limit);

  while (body.length > BODY_LIMIT && limit > 1) {
    limit = limit === Number.POSITIVE_INFINITY ? 200 : Math.floor(limit / 2);
    body = render(limit);
  }

  return { body, fingerprint, state };
};

const readReport = (dir: string): ScanReport | undefined => {
  try {
    const recorded = readFileSync(path.join(dir, "status"), "utf-8").trim();
    const status = Number(recorded);

    if (recorded === "" || !Number.isInteger(status)) {
      return undefined;
    }

    return { output: readFileSync(path.join(dir, "output"), "utf-8"), status };
  } catch {
    return undefined;
  }
};

if (import.meta.main) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      commit: { type: "string" },
      run: { type: "string" },
    },
  });

  const [dir] = positionals;

  if (
    dir === undefined ||
    positionals.length > 1 ||
    values.commit === undefined ||
    values.run === undefined
  ) {
    console.error(
      "usage: node scripts/scan-report.ts <report-dir> --commit <sha> --run <url>"
    );
    process.exit(2);
  }

  const results = new Map(
    SCANS.map(({ key }) => [
      key,
      readScan(readReport(path.join(dir, `scan-report-${key}`))),
    ])
  );

  console.log(
    JSON.stringify(
      buildReport(results, { commit: values.commit, runUrl: values.run })
    )
  );
}
