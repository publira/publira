/**
 * The Upgrade notes section of a pull request: what an operator upgrading to
 * the release that carries the pull request has to do. The `Release notes`
 * workflow holds a pull request to it and copies it into the release notes.
 *
 *     node scripts/upgrade-notes.ts check < pull-request.json
 *     node scripts/upgrade-notes.ts render < release.json
 *
 * `check` reads `{ body, files }`, the pull request's body and the entries of
 * `GET /repos/{owner}/{repo}/pulls/{number}/files`, and fails when the diff
 * makes a change an operator may have to act on while the section is empty.
 * It runs from a checkout of the base branch, which it searches for the
 * environment variables the diff names.
 *
 * `render` reads `{ pulls, previousTag }`, the pull requests merged since the
 * previous release tag, and prints the Upgrade notes section of the release.
 */

import { execFileSync } from "node:child_process";
import { text } from "node:stream/consumers";

/** One entry of `GET /repos/{owner}/{repo}/pulls/{number}/files`. */
export interface ChangedFile {
  filename: string;
  patch?: string;
  previous_filename?: string;
  status: string;
}

export interface MergedPullRequest {
  body: string | null;
  number: number;
  title: string;
}

const HEADING = /^##\s+upgrade notes\s*$/iu;

/** The heading that ends the section: the next one of the same level or above. */
const NEXT_HEADING = /^#{1,2}\s/u;

const COMMENT = /<!--[\s\S]*?-->/gu;

/**
 * The text of the Upgrade notes section in `body`, without the template's
 * comments: an empty string when the section is left blank, and `undefined`
 * when the body has no such section, as a pull request opened without the
 * template does.
 */
export const readUpgradeNotes = (
  body: string | null | undefined
): string | undefined => {
  const lines = (body ?? "")
    .replaceAll("\r\n", "\n")
    .replaceAll(COMMENT, "")
    .split("\n");
  const start = lines.findIndex((line) => HEADING.test(line));
  if (start === -1) {
    return undefined;
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => NEXT_HEADING.test(line));

  return (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
};

/** Whether the section declares that the pull request asks nothing. */
export const declaresNone = (notes: string): boolean =>
  /^none\.?$/iu.test(notes.trim());

const MIGRATION = /^db\/migrations\/[^/]+\.up\.sql$/u;

/** The list of login roles `publiractl db roles` asks a password for. */
const ROLES = "server/internal/dbroles/dbroles.go";

const COMPOSE = "infra/deploy/compose.yaml";

/**
 * A line added or removed at the second level of the Compose file: a service,
 * a secret, or a volume, each of which an install has to run or provide.
 */
const COMPOSE_ENTRY = /^[+-] {2}[a-z][\w-]*:\s*$/u;

const ENV_NAME = /\bPUBLIRA_[A-Z0-9_]*[A-Z0-9]\b/gu;

const TEST = /(?:_test\.go|\.(?:test|spec)\.tsx?)$|(?:^|\/)testdata\//u;

/**
 * Whether `path` ships in an install: the server, the web apps and the
 * packages they are built from, and the deployment, image, and edge files.
 * Tests and documentation name variables too, and the development tooling
 * reads variables of its own, but no operator sets those.
 */
export const isInstallSource = (path: string): boolean =>
  /^(?:server|apps|packages|infra)\//u.test(path) &&
  !path.endsWith(".md") &&
  !TEST.test(path);

const changedLines = (patch: string | undefined, sign: "+" | "-"): string[] =>
  (patch ?? "")
    .split("\n")
    .filter((line) => line.startsWith(sign) && !line.startsWith(sign.repeat(3)))
    .map((line) => line.slice(1));

const namesIn = (lines: readonly string[]): Set<string> =>
  new Set(lines.flatMap((line) => line.match(ENV_NAME) ?? []));

/**
 * The lines that name `name` in each file of the base branch that ships in an
 * install, keyed by path.
 */
export type BaseLookup = (name: string) => Map<string, number>;

/**
 * The environment variables the diff starts or stops reading. A name only
 * added is new when the base branch names it nowhere, and a name only removed
 * is gone when the diff removes every line of the base branch that names it.
 * Moving a read from one file to another adds and removes the same name, so it
 * is neither.
 */
export const environmentChanges = (
  files: readonly ChangedFile[],
  lookup: BaseLookup
): { added: string[]; removed: string[] } => {
  const shipped = files.filter(
    ({ filename, previous_filename: previous }) =>
      isInstallSource(filename) ||
      (previous !== undefined && isInstallSource(previous))
  );
  const plus = shipped.map((file) => changedLines(file.patch, "+"));
  const minus = shipped.map((file) => changedLines(file.patch, "-"));
  const addedNames = namesIn(plus.flat());
  const removedNames = namesIn(minus.flat());

  const added = [...addedNames]
    .filter((name) => !removedNames.has(name))
    .filter((name) => lookup(name).size === 0);

  const removed = [...removedNames]
    .filter((name) => !addedNames.has(name))
    .filter((name) =>
      [...lookup(name)].every(([path, count]) => {
        const index = shipped.findIndex(
          (file) => (file.previous_filename ?? file.filename) === path
        );
        if (index === -1) {
          return false;
        }
        const pattern = new RegExp(`\\b${name}\\b`, "u");

        return (
          minus[index].filter((line) => pattern.test(line)).length >= count
        );
      })
    );

  return { added: added.toSorted(), removed: removed.toSorted() };
};

/**
 * The changes in the diff an operator may have to act on, each as a sentence
 * naming it. The author decides whether one asks something of an operator; the
 * check only makes sure the question was answered.
 */
export const watchedChanges = (
  files: readonly ChangedFile[],
  lookup: BaseLookup
): string[] => {
  const changes: string[] = [];

  for (const file of files) {
    if (file.status === "added" && MIGRATION.test(file.filename)) {
      changes.push(`adds the migration ${file.filename}`);
    }
  }
  const routing = files.filter(({ filename, previous_filename: previous }) =>
    [filename, previous].some(
      (path) => path?.startsWith("infra/proxy/") && !path.endsWith(".md")
    )
  );
  for (const file of routing) {
    changes.push(`changes the routing in ${file.filename}`);
  }
  if (files.some(({ filename }) => filename === ROLES)) {
    changes.push(`changes the database roles in ${ROLES}`);
  }
  const compose = files.find(({ filename }) => filename === COMPOSE);
  if (compose?.patch?.split("\n").some((line) => COMPOSE_ENTRY.test(line))) {
    changes.push(
      `adds or removes a service, a secret, or a volume in ${COMPOSE}`
    );
  }
  const { added, removed } = environmentChanges(files, lookup);
  for (const name of added) {
    changes.push(`starts reading ${name}`);
  }
  for (const name of removed) {
    changes.push(`stops reading ${name}`);
  }

  return changes;
};

// Absolute path avoids PATH lookup (oxlint sonarjs/no-os-command-from-path).
const GIT = "/usr/bin/git";

/** {@link BaseLookup} over the checkout the process runs in. */
const gitGrep: BaseLookup = (name) => {
  let output = "";
  try {
    output = execFileSync(
      GIT,
      [
        "grep",
        "--count",
        "-w",
        "-e",
        name,
        "--",
        "server",
        "apps",
        "packages",
        "infra",
      ],
      { encoding: "utf-8" }
    );
  } catch {
    // git grep exits 1 when nothing matches.
  }

  return new Map(
    output
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const at = line.lastIndexOf(":");

        return [line.slice(0, at), Number(line.slice(at + 1))] as const;
      })
      .filter(([path]) => isInstallSource(path))
  );
};

const FIRST_RELEASE =
  "This is the first release, so there is no earlier release to upgrade from.";

const NOTHING =
  "No change in this release asks anything of an operator beyond the steps of upgrading.";

/**
 * The Upgrade notes section of a release: the section of every pull request
 * that filled one in with more than "None.", oldest first, under the pull
 * request's title. It is there even when no pull request asks anything, so
 * that an empty section says so rather than looking forgotten.
 */
export const renderReleaseNotes = (
  pulls: readonly MergedPullRequest[],
  previousTag: string | null
): string => {
  const lines = ["## Upgrade notes", ""];
  if (previousTag === null) {
    return [...lines, FIRST_RELEASE, ""].join("\n");
  }
  const entries = pulls
    .map((pull) => ({ ...pull, notes: readUpgradeNotes(pull.body) ?? "" }))
    .filter(({ notes }) => notes !== "" && !declaresNone(notes))
    .toSorted((a, b) => a.number - b.number);
  if (entries.length === 0) {
    return [...lines, NOTHING, ""].join("\n");
  }
  for (const { notes, number, title } of entries) {
    lines.push(`### ${title} (#${number})`, "", notes, "");
  }

  return lines.join("\n");
};

const check = (input: { body: string | null; files: ChangedFile[] }): void => {
  const changes = watchedChanges(input.files, gitGrep);
  if (changes.length === 0) {
    console.log("Nothing in this diff is a change an operator acts on.");

    return;
  }
  const notes = readUpgradeNotes(input.body);
  for (const change of changes) {
    console.log(`This pull request ${change}.`);
  }
  if (notes !== undefined && notes !== "") {
    console.log("\nIts Upgrade notes section answers for them.");

    return;
  }
  console.error(
    [
      "",
      notes === undefined
        ? "The description has no Upgrade notes section."
        : "Its Upgrade notes section is empty.",
      "Write there what an operator upgrading to the release that carries it has to do,",
      'or "None." when none of these changes asks anything of them.',
      "See the Upgrade notes section of .github/pull_request_template.md.",
    ].join("\n")
  );
  process.exitCode = 1;
};

if (import.meta.main) {
  const command = process.argv.at(2);
  const input = JSON.parse(await text(process.stdin));
  if (command === "check") {
    check(input);
  } else if (command === "render") {
    process.stdout.write(renderReleaseNotes(input.pulls, input.previousTag));
  } else {
    console.error(
      "usage: node scripts/upgrade-notes.ts check|render < input.json"
    );
    process.exitCode = 2;
  }
}
