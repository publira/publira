/**
 * The critical findings of a release's images, split by the layer they are
 * in and held to the findings a maintainer has accepted.
 * `scripts/scan-image.sh` writes one directory per image and architecture,
 * and the `Images / Scan` job hands the parent of all of them here:
 *
 *     node scripts/image-vulns.ts infra/docker/trivy-ignore.json scan/
 *
 * where `scan/<image>/<arch>/` holds `trivy.json` and `base.json`.
 *
 * An image is the layers of its base image, the one the final stage of its
 * Dockerfile starts FROM, followed by the layers `infra/docker/` adds. A
 * finding in the added layers fails the run: it is a package this repository
 * installs or copies in, and a change here removes it. A finding in the base
 * layers is reported and passes, because what removes it is a release of the
 * base image, which no change here can bring forward.
 *
 * The run also fails on an entry whose expiry has passed, whether or not the
 * finding is still there, and on an ignore file that does not hold to its
 * shape. An entry no image needs any more is a warning, left to delete.
 *
 * With `GITHUB_STEP_SUMMARY` set, the findings are appended to it as
 * Markdown, in three tables: what holds the release, what the base images
 * carry, and what is accepted, with the reason and the expiry of each.
 */

import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { isJsonObject, isJsonString } from "./json-value.ts";
import type { JsonObject, JsonValue } from "./json-value.ts";

/** One layer of an image, as a finding names it. */
export interface Layer {
  /** The instruction that made it, from the image's history, when known. */
  readonly createdBy: string | undefined;
  readonly diffId: string;
  /** Its position among the image's layers, from 1, or 0 when not among them. */
  readonly position: number;
}

/** One critical advisory against one package of one image. */
export interface Finding {
  /** The version that fixes it, or `undefined` when none does yet. */
  readonly fixedVersion: string | undefined;
  /** The advisory's ID as Trivy reports it: `CVE-…`, `GHSA-…`, and so on. */
  readonly id: string;
  /** The image and platform, as `publira (linux/arm64)`. */
  readonly image: string;
  /** Whether the layer is one of the base image's. */
  readonly inBase: boolean;
  readonly installedVersion: string;
  readonly layer: Layer;
  readonly packageName: string;
  /** Where Trivy found the package: the OS, or a file of the image. */
  readonly target: string;
  readonly title: string;
  readonly url: string | undefined;
}

/** The image the final stage starts FROM, as `base.json` gives it. */
export interface Base {
  readonly diffIds: readonly string[];
  readonly digest: string;
  readonly name: string;
}

/** One scanned image and platform. */
export interface Scan {
  readonly base: Base;
  readonly findings: readonly Finding[];
  readonly image: string;
  /** How many layers the image has, the base's included. */
  readonly layers: number;
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
  /** The file the problem is in, when it is in a file. */
  readonly file?: string;
  readonly message: string;
}

/** A finding an unexpired entry suppresses, with that entry. */
export interface Ignored {
  readonly entry: IgnoreEntry;
  readonly finding: Finding;
}

export interface Report {
  /** Unaccepted findings in the base layers, reported without failing. */
  readonly base: readonly Finding[];
  readonly errors: readonly Problem[];
  /** Unaccepted findings in the layers added on top of the base, which fail. */
  readonly held: readonly Finding[];
  readonly ignored: readonly Ignored[];
  readonly warnings: readonly Problem[];
}

const stringField = (object: JsonObject, key: string): string | undefined => {
  const value = object[key];

  return isJsonString(value) && value !== "" ? value : undefined;
};

const stringArray = (value: JsonValue | undefined): string[] | undefined =>
  Array.isArray(value) && value.every(isJsonString) ? [...value] : undefined;

/** `base.json`, as `scripts/scan-image.sh` writes it. */
export const readBase = (source: string): Base => {
  const parsed: JsonValue = JSON.parse(source);

  if (!isJsonObject(parsed)) {
    throw new Error("expected an object");
  }

  const name = stringField(parsed, "name");
  const digest = stringField(parsed, "digest");
  const diffIds = stringArray(parsed.diffIds);

  if (name === undefined || digest === undefined || diffIds === undefined) {
    throw new Error("expected a `name`, a `digest`, and a `diffIds` array");
  }

  return { diffIds, digest, name };
};

/**
 * The instruction behind each layer, in layer order: the history lists every
 * instruction, and those that made no layer are marked `empty_layer`.
 */
const layerHistory = (
  metadata: JsonObject,
  layers: number
): (string | undefined)[] => {
  const config = metadata.ImageConfig;

  const history =
    isJsonObject(config) && Array.isArray(config.history)
      ? config.history.filter(isJsonObject)
      : [];

  const made = history
    .filter((entry) => entry.empty_layer !== true)
    .map((entry) => {
      const createdBy = stringField(entry, "created_by");

      // BuildKit records a RUN as the shell it ran and marks each of its own
      // instructions; neither says anything the Dockerfile line does not.
      return createdBy
        ?.replace(/^RUN \/bin\/sh -c /u, "RUN ")
        .replace(/ # buildkit$/u, "")
        .replaceAll(/\s+/gu, " ");
    });

  // A history that does not match the layers one to one names none of them.
  return made.length === layers ? made : [];
};

interface FindingContext {
  /** How many of the image's first layers are the base image's. */
  readonly baseLayers: number;
  readonly diffIds: readonly string[];
  readonly history: readonly (string | undefined)[];
  readonly image: string;
  readonly target: string;
}

/** One vulnerability of a Trivy result, or `undefined` when it is not critical. */
const readFinding = (
  vulnerability: JsonObject,
  { baseLayers, diffIds, history, image, target }: FindingContext
): Finding | undefined => {
  const id = stringField(vulnerability, "VulnerabilityID");

  if (
    id === undefined ||
    stringField(vulnerability, "Severity") !== "CRITICAL"
  ) {
    return undefined;
  }

  const layer = isJsonObject(vulnerability.Layer) ? vulnerability.Layer : {};
  const diffId = stringField(layer, "DiffID") ?? "";
  const index = diffIds.indexOf(diffId);

  return {
    fixedVersion: stringField(vulnerability, "FixedVersion"),
    id,
    image,
    // A finding Trivy places in no layer of the image is not known to be the
    // base's, so it is held to the stricter rule.
    inBase: index !== -1 && index < baseLayers,
    installedVersion: stringField(vulnerability, "InstalledVersion") ?? "",
    layer: {
      createdBy: index === -1 ? undefined : history[index],
      diffId,
      position: index + 1,
    },
    packageName: stringField(vulnerability, "PkgName") ?? "",
    target,
    title: stringField(vulnerability, "Title") ?? "",
    url: stringField(vulnerability, "PrimaryURL"),
  };
};

/**
 * The critical findings of one `trivy image --format json` report of the
 * image named `image`, built on `base`.
 */
export const readScan = (source: string, image: string, base: Base): Scan => {
  const parsed: JsonValue = JSON.parse(source);

  if (
    !isJsonObject(parsed) ||
    stringField(parsed, "ArtifactType") !== "container_image" ||
    !isJsonObject(parsed.Metadata)
  ) {
    throw new Error(
      "not the output of trivy image --format json: expected an object with ArtifactType container_image and Metadata"
    );
  }

  const { Metadata: metadata } = parsed;
  const diffIds = stringArray(metadata.DiffIDs);

  if (diffIds === undefined || diffIds.length === 0) {
    throw new Error("the report lists no layer under Metadata.DiffIDs");
  }

  // An image built FROM the base starts with every layer of it, in order. One
  // that does not was built on something else than its annotations say, and
  // no layer of it can be called the base's.
  if (
    base.diffIds.length === 0 ||
    base.diffIds.length > diffIds.length ||
    base.diffIds.some((diffId, index) => diffIds[index] !== diffId)
  ) {
    throw new Error(
      `the image does not start with the ${base.diffIds.length} layers of ${base.name}@${base.digest}, the base its annotations name`
    );
  }

  const history = layerHistory(metadata, diffIds.length);

  const results = Array.isArray(parsed.Results)
    ? parsed.Results.filter(isJsonObject)
    : [];

  const findings: Finding[] = [];
  const seen = new Set<string>();

  for (const result of results) {
    const target = stringField(result, "Target") ?? "";

    const vulnerabilities = Array.isArray(result.Vulnerabilities)
      ? result.Vulnerabilities.filter(isJsonObject)
      : [];

    for (const vulnerability of vulnerabilities) {
      const finding = readFinding(vulnerability, {
        baseLayers: base.diffIds.length,
        diffIds,
        history,
        image,
        target,
      });

      const key =
        finding === undefined
          ? undefined
          : [
              finding.id,
              target,
              finding.packageName,
              finding.installedVersion,
            ].join("\0");

      if (finding !== undefined && key !== undefined && !seen.has(key)) {
        seen.add(key);
        findings.push(finding);
      }
    }
  }

  return { base, findings, image, layers: diffIds.length };
};

/** What the ignore file holds, or the problems that keep it from being read. */
export interface IgnoreFile {
  readonly entries: readonly IgnoreEntry[];
  readonly problems: readonly Problem[];
}

const ADVISORY_ID = /^[A-Z][A-Z0-9]*-[A-Za-z0-9][\w.:-]*$/u;
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

/**
 * The entries of the ignore file: an object whose `ignore` is an array of
 * entries, each with an advisory `id`, a `reason`, and an `expires` date.
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
    const label = `entry ${index + 1}`;

    if (!isJsonObject(value)) {
      problems.push({ file, message: `${label} is not an object` });
      continue;
    }

    const id = stringField(value, "id");
    const reason = stringField(value, "reason")?.trim();
    const expires = parseDate(stringField(value, "expires"));
    const name = id ?? label;
    const before = problems.length;

    if (id === undefined || !ADVISORY_ID.test(id)) {
      problems.push({
        file,
        message: `${label} needs an \`id\`, the advisory as Trivy reports it, such as CVE-YYYY-NNNN`,
      });
    } else if (seen.has(id)) {
      problems.push({ file, message: `${id} is listed twice` });
    }

    if (reason === undefined || reason === "") {
      problems.push({
        file,
        message: `${name} needs a \`reason\` saying why it is accepted`,
      });
    }

    if (expires === undefined) {
      problems.push({
        file,
        message: `${name} needs an \`expires\` date, YYYY-MM-DD`,
      });
    }

    if (id !== undefined) {
      seen.add(id);
    }

    if (
      problems.length === before &&
      id !== undefined &&
      reason !== undefined &&
      expires !== undefined
    ) {
      entries.push({ expires, id, reason });
    }
  }

  return { entries, problems };
};

const shortDigest = (digest: string): string =>
  digest.startsWith("sha256:") && digest.length > 19
    ? `${digest.slice(0, 19)}…`
    : digest;

const truncate = (text: string, length: number): string =>
  text.length > length ? `${text.slice(0, length - 1)}…` : text;

/** The layer as a sentence names it: its position, digest, and instruction. */
export const describeLayer = (finding: Finding, layers: number): string => {
  const { createdBy, diffId, position } = finding.layer;

  if (position === 0) {
    return `a layer the image does not list (${diffId === "" ? "none given" : shortDigest(diffId)})`;
  }

  const made =
    createdBy === undefined ? "" : `, made by ${truncate(createdBy, 160)}`;

  return `layer ${position} of ${layers} (${shortDigest(diffId)}${made})`;
};

const describeFix = (finding: Finding): string =>
  finding.fixedVersion === undefined
    ? "no fixed version yet"
    : `fixed in ${finding.fixedVersion}`;

/** The advisory and the package, as one line of the log reads. */
export const describe = (finding: Finding): string => {
  const title = finding.title === "" ? "" : `: ${finding.title}`;
  const url = finding.url === undefined ? "" : `; ${finding.url}`;

  return `${finding.id}${title} (${finding.packageName} ${finding.installedVersion} in ${finding.target}, ${describeFix(finding)}${url})`;
};

export interface EvaluateOptions {
  /** The ignore file, named in its problems. */
  readonly file: string;
  readonly today: Temporal.PlainDate;
}

/**
 * The findings of every scan held to the ignore file's entries on `today`. An
 * entry suppresses its advisory in every image through the day it expires;
 * from the day after, it is an error whether or not the advisory is still
 * found.
 */
export const evaluate = (
  scans: readonly Scan[],
  entries: readonly IgnoreEntry[],
  { file, today }: EvaluateOptions
): Report => {
  const errors: Problem[] = [];
  const warnings: Problem[] = [];
  const held: Finding[] = [];
  const base: Finding[] = [];
  const ignored: Ignored[] = [];
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const findings = scans.flatMap((scan) => scan.findings);
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
        message: `${entry.id} is no longer found in any image; delete its entry`,
      });
    }
  }

  for (const scan of scans) {
    for (const finding of scan.findings) {
      const entry = byId.get(finding.id);

      if (
        entry !== undefined &&
        Temporal.PlainDate.compare(entry.expires, today) >= 0
      ) {
        ignored.push({ entry, finding });
      } else if (finding.inBase) {
        base.push(finding);
        warnings.push({
          message: `${finding.image}: ${describe(finding)}, in ${describeLayer(finding, scan.layers)} of the base image ${scan.base.name}. Moving to a release of the base image that fixes it removes it`,
        });
      } else {
        held.push(finding);
        errors.push({
          message: `${finding.image}: ${describe(finding)}, in ${describeLayer(finding, scan.layers)}, which infra/docker/ adds on top of ${scan.base.name}`,
        });
      }
    }
  }

  return { base, errors, held, ignored, warnings };
};

const cell = (text: string): string =>
  text.replaceAll("\\", "\\\\").replaceAll("|", "\\|").replaceAll("\n", " ");

const code = (text: string): string =>
  text === "" ? "" : `\`${text.replaceAll("`", "'")}\``;

const advisory = (finding: Finding): string =>
  finding.url === undefined
    ? cell(finding.id)
    : `[${cell(finding.id)}](${finding.url})`;

const table = (
  header: readonly string[],
  rows: readonly (readonly string[])[]
): string[] => [
  `| ${header.join(" | ")} |`,
  `| ${header.map(() => "---").join(" | ")} |`,
  ...rows.map((row) => `| ${row.join(" | ")} |`),
];

/** The job summary: what holds the release, what the bases carry, what is accepted. */
export const renderSummary = (
  scans: readonly Scan[],
  report: Report
): string => {
  const layersOf = new Map(scans.map((scan) => [scan.image, scan]));

  const layer = (finding: Finding): string => {
    const scan = layersOf.get(finding.image);
    const { createdBy, position } = finding.layer;

    if (position === 0 || scan === undefined) {
      return "unknown";
    }

    const made =
      createdBy === undefined ? "" : ` ${code(truncate(createdBy, 80))}`;

    return `${position} of ${scan.layers}${cell(made)}`;
  };

  const row = (finding: Finding): string[] => [
    cell(finding.image),
    advisory(finding),
    cell(`${finding.packageName} ${finding.installedVersion}`),
    cell(finding.fixedVersion ?? "none yet"),
    layer(finding),
  ];

  const lines = ["## Image scan", ""];

  lines.push(
    `Trivy scanned ${scans.length} image${scans.length === 1 ? "" : "s"} for critical findings: ${scans.map((scan) => cell(scan.image)).join(", ")}.`,
    ""
  );

  if (
    report.held.length === 0 &&
    report.base.length === 0 &&
    report.ignored.length === 0
  ) {
    lines.push("No image carries a critical finding.", "");

    return lines.join("\n");
  }

  const header = ["Image", "Advisory", "Package", "Fixed in", "Layer"];

  if (report.held.length > 0) {
    lines.push(
      "### Holding the release",
      "",
      "In the layers `infra/docker/` adds on top of the base image.",
      "",
      ...table(header, report.held.map(row)),
      ""
    );
  }

  if (report.base.length > 0) {
    lines.push(
      "### In the base images",
      "",
      "Reported, not held: a release of the base image removes them.",
      "",
      ...table(
        [...header, "Base image"],
        report.base.map((finding) => [
          ...row(finding),
          code(layersOf.get(finding.image)?.base.name ?? ""),
        ])
      ),
      ""
    );
  }

  if (report.ignored.length > 0) {
    lines.push(
      "### Accepted",
      "",
      "Suppressed by `infra/docker/trivy-ignore.json` until the end of the day each expires, in UTC.",
      "",
      ...table(
        [...header, "Reason", "Expires"],
        report.ignored.map(({ entry, finding }) => [
          ...row(finding),
          cell(entry.reason),
          entry.expires.toString(),
        ])
      ),
      ""
    );
  }

  return lines.join("\n");
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

/** Every `<image>/<arch>/` directory under `root`, read as one scan. */
const readScans = (root: string): Scan[] =>
  readdirSync(root, { withFileTypes: true })
    .filter((image) => image.isDirectory())
    .toSorted((a, b) => a.name.localeCompare(b.name))
    .flatMap((image) =>
      readdirSync(path.join(root, image.name), { withFileTypes: true })
        .filter((arch) => arch.isDirectory())
        .toSorted((a, b) => a.name.localeCompare(b.name))
        .map((arch) => {
          const dir = path.join(root, image.name, arch.name);
          const name = `${image.name} (linux/${arch.name})`;

          try {
            return readScan(
              readFileSync(path.join(dir, "trivy.json"), "utf-8"),
              name,
              readBase(readFileSync(path.join(dir, "base.json"), "utf-8"))
            );
          } catch (error) {
            const reason =
              error instanceof Error ? error.message : String(error);

            throw new Error(`${name}: ${reason}`, { cause: error });
          }
        })
    );

if (import.meta.main) {
  const [file, root, ...rest] = process.argv.slice(2);

  if (file === undefined || root === undefined || rest.length > 0) {
    console.error(
      "usage: node scripts/image-vulns.ts <ignore-file> <scan-dir>"
    );
    process.exit(2);
  }

  const scans = readScans(root);

  if (scans.length === 0) {
    console.error(`${root} holds no <image>/<arch>/ scan`);
    process.exit(1);
  }

  const { entries, problems } = readIgnoreFile(
    readFileSync(file, "utf-8"),
    file
  );

  const report = evaluate(scans, entries, {
    file,
    today: Temporal.Now.plainDateISO("UTC"),
  });

  for (const { entry, finding } of report.ignored) {
    console.log(
      `ignored until ${entry.expires}: ${finding.image}: ${describe(finding)}. Accepted because: ${entry.reason}`
    );
  }

  for (const warning of report.warnings) {
    print("warning", warning);
  }

  for (const error of [...problems, ...report.errors]) {
    print("error", error);
  }

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;

  if (summaryPath !== undefined && summaryPath !== "") {
    appendFileSync(summaryPath, `${renderSummary(scans, report)}\n`);
  }

  if (problems.length > 0 || report.errors.length > 0) {
    process.exitCode = 1;
  } else {
    console.log(
      `trivy: no critical finding outside the base images and ${file} across ${scans.length} images (${report.base.length} in base images, ${report.ignored.length} ignored)`
    );
  }
}
