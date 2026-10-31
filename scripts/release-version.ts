/**
 * The version of a release, carried by every `package.json` the repository
 * tracks, the root included. A release is cut from a commit that sets it, and
 * the `Release notes` workflow refuses a tag whose commit carries another.
 *
 *     node scripts/release-version.ts set 0.2.0
 *     node scripts/release-version.ts check 0.2.0
 *
 * `set` rewrites the `version` line of each file and nothing else, for the
 * release commit. `check` fails naming each file whose version is not the
 * given one.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { isJsonString } from "./json-value.ts";
import type { JsonValue } from "./json-value.ts";

/**
 * A prerelease identifier as SemVer allows it: a number has no leading zero,
 * and anything with a letter or a hyphen in it is not a number.
 */
const PRERELEASE_IDENTIFIER = String.raw`(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)`;

/**
 * A version that is also a release tag: SemVer without build metadata, which
 * an image tag cannot carry.
 */
const RELEASE_VERSION = new RegExp(
  String.raw`^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-${PRERELEASE_IDENTIFIER}(?:\.${PRERELEASE_IDENTIFIER})*)?$`,
  "u"
);

export const isReleaseVersion = (version: string): boolean =>
  RELEASE_VERSION.test(version);

// Absolute path avoids PATH lookup (oxlint sonarjs/no-os-command-from-path).
const GIT = "/usr/bin/git";

/**
 * The repository's `package.json` files, relative to `root`. Tracked files
 * only, so nothing under `node_modules/` is one of them.
 */
export const listManifests = (root: string): string[] =>
  execFileSync(
    GIT,
    ["ls-files", "-z", "--", "package.json", "*/package.json"],
    { cwd: root, encoding: "utf-8" }
  )
    .split("\0")
    .filter(Boolean);

const VERSION_LINE =
  /^(?<head>[ \t]*"version"[ \t]*:[ \t]*)"[^"\\]*"(?<tail>,?[ \t]*\r?)$/u;

/**
 * `text` with its top-level `version` set to `version` and every other line as
 * it was. A nested `version`, such as `devEngines.runtime.version`, is indented
 * deeper than the top-level one, which is how the two are told apart.
 */
export const setVersion = (text: string, version: string): string => {
  const lines = text.split("\n");
  let target: number | undefined;
  let indent = Number.POSITIVE_INFINITY;

  for (const [index, line] of lines.entries()) {
    const match = VERSION_LINE.exec(line);
    const depth = match?.groups?.head.search(/\S/u) ?? -1;

    if (match && depth < indent) {
      target = index;
      indent = depth;
    }
  }

  if (target === undefined) {
    throw new Error("it has no version on a line of its own");
  }

  const { head, tail } = VERSION_LINE.exec(lines[target])?.groups ?? {};
  lines[target] = `${head}${JSON.stringify(version)}${tail}`;
  const result = lines.join("\n");

  // The line chosen is the top-level one only if the parsed file says so.
  const before = JSON.parse(text);
  const after = JSON.parse(result);

  if (!isDeepStrictEqual(after, { ...before, version })) {
    throw new Error("its top-level version is not on a line of its own");
  }

  return result;
};

export interface Manifest {
  path: string;
  text: string;
}

/** One line per manifest whose top-level `version` is not `version`. */
export const findMismatches = (
  manifests: readonly Manifest[],
  version: string
): string[] =>
  manifests.flatMap((manifest) => {
    const actual: JsonValue | undefined = JSON.parse(manifest.text).version;

    if (actual === version) {
      return [];
    }

    return [
      isJsonString(actual)
        ? `${manifest.path} carries ${actual}, not ${version}.`
        : `${manifest.path} carries no version, not ${version}.`,
    ];
  });

export const readManifests = (root: string): Manifest[] =>
  listManifests(root).map((file) => ({
    path: file,
    text: readFileSync(path.join(root, file), "utf-8"),
  }));

/** Every file is rewritten in memory first, so a refusal leaves none changed. */
const set = (root: string, version: string): void => {
  const updates = readManifests(root).map((manifest) => {
    try {
      return { ...manifest, text: setVersion(manifest.text, version) };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);

      throw new Error(`${manifest.path}: ${reason}`, {
        cause: error,
      });
    }
  });

  for (const manifest of updates) {
    writeFileSync(path.join(root, manifest.path), manifest.text);
    console.log(`${manifest.path}: ${version}`);
  }
};

const check = (root: string, version: string): void => {
  const manifests = readManifests(root);
  const mismatches = findMismatches(manifests, version);

  if (mismatches.length === 0) {
    console.log(`All ${manifests.length} package.json files carry ${version}.`);

    return;
  }

  console.error(
    [
      ...mismatches,
      "",
      `A release is cut from a commit that sets every package.json to its version: run \`node scripts/release-version.ts set ${version}\`,`,
      "merge it through a pull request, and tag the commit that merges it.",
      "See Cutting a release in .github/workflows/README.md.",
    ].join("\n")
  );
  process.exitCode = 1;
};

if (import.meta.main) {
  const [command, version] = process.argv.slice(2);
  const root = path.join(import.meta.dirname, "..");

  if ((command !== "set" && command !== "check") || version === undefined) {
    console.error("usage: node scripts/release-version.ts set|check <version>");
    process.exitCode = 2;
  } else if (!isReleaseVersion(version)) {
    console.error(
      `${version} is not a release version: 1.2.3, or 1.2.3-rc.1 for a prerelease.`
    );
    process.exitCode = 1;
  } else if (command === "set") {
    set(root, version);
  } else {
    check(root, version);
  }
}
