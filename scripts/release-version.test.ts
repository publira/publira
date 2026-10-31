import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import {
  findMismatches,
  isReleaseVersion,
  readManifests,
  setVersion,
} from "./release-version.ts";

/** The root package.json as the repository formats it, nested version included. */
const ROOT_MANIFEST = [
  "{",
  '  "name": "@publira/monorepo",',
  '  "version": "0.1.0",',
  '  "scripts": {',
  '    "test": "turbo run test"',
  "  },",
  '  "devEngines": {',
  '    "runtime": {',
  '      "name": "node",',
  '      "version": "24.21.0"',
  "    }",
  "  }",
  "}",
  "",
].join("\n");

const manifest = (name: string, version?: string): string =>
  `${JSON.stringify({ name, private: true, version }, null, 2)}\n`;

describe("isReleaseVersion", () => {
  it("accepts a release and a prerelease", () => {
    for (const version of [
      "0.1.0",
      "1.12.0",
      "0.2.0-rc.1",
      "2.0.0-beta",
      "1.2.3-0",
      "1.2.3-rc.0.10",
      "1.2.3-0a",
      "1.2.3--01",
    ]) {
      assert.equal(isReleaseVersion(version), true, version);
    }
  });

  it("refuses what a release tag cannot be", () => {
    for (const version of [
      "v0.1.0",
      "0.1",
      "01.0.0",
      "0.1.0+build.1",
      "1.2.3-01",
      "1.2.3-alpha.01",
      "1.2.3-rc..1",
      "",
    ]) {
      assert.equal(isReleaseVersion(version), false, version);
    }
  });
});

describe("setVersion", () => {
  it("changes the top-level version line and no other", () => {
    const result = setVersion(ROOT_MANIFEST, "0.2.0-rc.1");
    const original = ROOT_MANIFEST.split("\n");
    const updated = result.split("\n");

    assert.equal(updated.length, original.length);

    const changed = updated.flatMap((line, index) =>
      line === original[index] ? [] : [[original[index], line]]
    );

    assert.deepEqual(changed, [
      ['  "version": "0.1.0",', '  "version": "0.2.0-rc.1",'],
    ]);
    assert.equal(JSON.parse(result).devEngines.runtime.version, "24.21.0");
  });

  it("keeps a CRLF line ending and a version on the last line", () => {
    const text = '{\r\n  "name": "a",\r\n  "version": "0.1.0"\r\n}\r\n';

    assert.equal(
      setVersion(text, "0.2.0"),
      '{\r\n  "name": "a",\r\n  "version": "0.2.0"\r\n}\r\n'
    );
  });

  it("refuses a file without a top-level version", () => {
    assert.throws(
      () => setVersion(manifest("@publira/utils"), "0.2.0"),
      /no version/u
    );
    // Only the nested one is on a line of its own.
    assert.throws(
      () =>
        setVersion(
          '{ "name": "a", "version": "0.1.0",\n  "engines": {\n    "version": "1"\n  }\n}\n',
          "0.2.0"
        ),
      /not on a line of its own/u
    );
  });
});

describe("findMismatches", () => {
  it("passes when every file carries the version", () => {
    assert.deepEqual(
      findMismatches(
        [
          { path: "package.json", text: ROOT_MANIFEST },
          { path: "apps/web-admin/package.json", text: manifest("a", "0.1.0") },
        ],
        "0.1.0"
      ),
      []
    );
  });

  it("names every file that carries another version or none", () => {
    assert.deepEqual(
      findMismatches(
        [
          { path: "package.json", text: ROOT_MANIFEST },
          { path: "apps/web-admin/package.json", text: manifest("a", "0.2.0") },
          { path: "packages/utils/package.json", text: manifest("b", "0.1.0") },
          { path: "e2e/package.json", text: manifest("c") },
        ],
        "0.2.0"
      ),
      [
        "package.json carries 0.1.0, not 0.2.0.",
        "packages/utils/package.json carries 0.1.0, not 0.2.0.",
        "e2e/package.json carries no version, not 0.2.0.",
      ]
    );
  });

  it("holds a prerelease to its exact version", () => {
    assert.deepEqual(
      findMismatches(
        [{ path: "package.json", text: manifest("a", "0.2.0") }],
        "0.2.0-rc.1"
      ),
      ["package.json carries 0.2.0, not 0.2.0-rc.1."]
    );
  });
});

describe("readManifests", () => {
  let root = "";

  const write = (file: string, text: string): void => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  };

  before(() => {
    root = mkdtempSync(path.join(tmpdir(), "release-version-"));
    execFileSync("/usr/bin/git", ["init", "--quiet"], { cwd: root });
    write("package.json", ROOT_MANIFEST);
    write("apps/web-admin/package.json", manifest("a", "0.1.0"));
    write("packages/ui/src/package.json", manifest("b", "0.1.0"));
    write("README.md", "package.json\n");
    execFileSync("/usr/bin/git", ["add", "."], { cwd: root });
    // Untracked, as an installed dependency is.
    write("node_modules/react/package.json", manifest("react", "19.3.0"));
  });

  after(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it("reads every tracked package.json at any depth, the root included", () => {
    assert.deepEqual(
      readManifests(root)
        .map((entry) => entry.path)
        .toSorted(),
      [
        "apps/web-admin/package.json",
        "package.json",
        "packages/ui/src/package.json",
      ]
    );
    assert.deepEqual(findMismatches(readManifests(root), "0.1.0"), []);
  });
});

describe("this repository", () => {
  it("carries one version in every package.json", () => {
    const root = path.join(import.meta.dirname, "..");

    const { version } = JSON.parse(
      readManifests(root).find((entry) => entry.path === "package.json")
        ?.text ?? "{}"
    );

    assert.equal(isReleaseVersion(version), true);
    assert.deepEqual(findMismatches(readManifests(root), version), []);
  });
});
