import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MARKER, buildReport, readErrors, readScan } from "./scan-report.ts";
import type { ScanResult } from "./scan-report.ts";

const OPTIONS = {
  commit: "0123456789abcdef0123456789abcdef01234567",
  runUrl: "https://github.com/publira/publira/actions/runs/1",
};

const results = (go: ScanResult, dependencies: ScanResult) =>
  new Map([
    ["go", go],
    ["dependencies", dependencies],
  ]);

const clean: ScanResult = { kind: "clean" };
const incomplete: ScanResult = { kind: "incomplete" };

const found = (...findings: string[]): ScanResult => ({
  findings,
  kind: "findings",
});

describe("readErrors", () => {
  it("reads the message of each error annotation and nothing else", () => {
    const output = [
      "ignored: GO-2026-0001 (example.com/a@v1.0.0, no fixed version yet)",
      "::warning::GO-2026-0002 is no longer reached; delete its entry",
      "::error::GO-2026-0003: Bad (example.com/b@v1.0.0, fixed in v1.0.1)",
      "below high: GHSA-aaaa-bbbb-cccc",
    ].join("\n");

    assert.deepEqual(readErrors(output), [
      "GO-2026-0003: Bad (example.com/b@v1.0.0, fixed in v1.0.1)",
    ]);
  });

  it("puts the file an annotation names before its message", () => {
    assert.deepEqual(
      readErrors(
        "::error file=osv-scanner.toml::GHSA-aaaa-bbbb-cccc expired on 2026-11-01\n"
      ),
      ["`osv-scanner.toml`: GHSA-aaaa-bbbb-cccc expired on 2026-11-01"]
    );
  });

  it("decodes what a workflow command escapes", () => {
    assert.deepEqual(readErrors("::error::100%25 of it%0Ain two lines"), [
      "100% of it\nin two lines",
    ]);
  });
});

describe("readScan", () => {
  it("is clean when the script passed", () => {
    assert.deepEqual(readScan({ output: "", status: 0 }), clean);
  });

  it("holds the errors of a script that failed on them", () => {
    assert.deepEqual(
      readScan({ output: "::error::GO-2026-0003: Bad\n", status: 1 }),
      found("GO-2026-0003: Bad")
    );
  });

  it("is incomplete when the script failed without an error annotation", () => {
    assert.deepEqual(
      readScan({ output: "osv-scanner exited with 127.\n", status: 127 }),
      incomplete
    );
  });

  it("is incomplete when the job left no report", () => {
    assert.deepEqual(readScan(undefined), incomplete);
  });
});

describe("buildReport", () => {
  it("is clean only when every scan is", () => {
    assert.equal(buildReport(results(clean, clean), OPTIONS).state, "clean");
    assert.equal(
      buildReport(results(clean, incomplete), OPTIONS).state,
      "incomplete"
    );
    assert.equal(buildReport(new Map(), OPTIONS).state, "incomplete");
  });

  it("files what any scan found, and says which scan did not finish", () => {
    const report = buildReport(
      results(found("GO-2026-0003: Bad"), incomplete),
      OPTIONS
    );

    assert.equal(report.state, "findings");
    assert.match(report.body, /^- GO-2026-0003: Bad$/mu);
    assert.match(report.body, /`Scan \/ Dependencies` did not finish/u);
    assert.match(report.body, /Scanned `0123456789abcdef/u);
  });

  it("starts the body with the marker and the fingerprint", () => {
    const report = buildReport(results(found("a"), clean), OPTIONS);
    const [first] = report.body.split("\n");

    assert.equal(first, `<!-- ${MARKER} fingerprint=${report.fingerprint} -->`);
  });

  it("keeps the fingerprint for the same findings in another run", () => {
    const first = buildReport(results(found("a", "b"), clean), OPTIONS);

    const second = buildReport(results(found("b", "a"), clean), {
      commit: "fedcba9876543210fedcba9876543210fedcba98",
      runUrl: "https://github.com/publira/publira/actions/runs/2",
    });

    assert.equal(first.fingerprint, second.fingerprint);
    assert.notEqual(first.body, second.body);
  });

  it("changes the fingerprint when the findings change", () => {
    const first = buildReport(results(found("a"), clean), OPTIONS);

    assert.notEqual(
      buildReport(results(found("a", "b"), clean), OPTIONS).fingerprint,
      first.fingerprint
    );
    assert.notEqual(
      buildReport(results(clean, found("a")), OPTIONS).fingerprint,
      first.fingerprint
    );
  });

  it("shortens a list too long for an Issue body and points to the run", () => {
    const many = Array.from(
      { length: 2000 },
      (_, index) =>
        `GO-2026-${String(index).padStart(4, "0")}: ${"x".repeat(80)}`
    );

    const report = buildReport(results(found(...many), clean), OPTIONS);

    assert.ok(report.body.length <= 65_536);
    assert.match(report.body, /…and \d+ more in \[the run\]/u);
  });
});
