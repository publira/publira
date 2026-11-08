import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  evaluate,
  readFindings,
  readIgnoreFile,
  splitJsonStream,
} from "./go-vulns.ts";
import type { Finding, IgnoreEntry } from "./go-vulns.ts";

const FILE = "server/govulncheck-ignore.json";

const config = {
  config: {
    protocol_version: "v1.0.0",
    scan_level: "symbol",
    scanner_name: "govulncheck",
  },
};

const osv = (id: string, summary: string) => ({ osv: { id, summary } });

const frame = (fields: Record<string, string>) => fields;

/** A finding message, its trace innermost frame first as govulncheck writes it. */
const finding = (
  id: string,
  trace: Record<string, string>[],
  fixed = "v1.20.2"
) => ({ finding: { fixed_version: fixed, osv: id, trace } });

const symbolTrace = [
  frame({
    function: "Compress1X",
    module: "github.com/klauspost/compress",
    package: "github.com/klauspost/compress/huff0",
    version: "v1.19.1",
  }),
  frame({
    function: "Write",
    module: "github.com/klauspost/compress",
    package: "github.com/klauspost/compress/zstd",
    receiver: "*Encoder",
    version: "v1.19.1",
  }),
  frame({
    function: "SendRenderedEmail",
    module: "github.com/publira/publira/server",
    package: "github.com/publira/publira/server/internal/smtp",
    receiver: "*Client",
  }),
];

const reachable: Finding = {
  callStack: [
    "github.com/publira/publira/server/internal/smtp.(*Client).SendRenderedEmail",
    "github.com/klauspost/compress/zstd.(*Encoder).Write",
    "github.com/klauspost/compress/huff0.Compress1X",
  ],
  fixedVersion: "v1.20.2",
  id: "GO-2026-6865",
  module: "github.com/klauspost/compress",
  summary: "Panic on two-block frames",
  version: "v1.19.1",
};

const entry = (id: string, expires: string): IgnoreEntry => ({
  expires: Temporal.PlainDate.from(expires),
  id,
  reason: "Accepted until the upgrade lands.",
});

const today = Temporal.PlainDate.from("2026-11-08");

describe("splitJsonStream", () => {
  it("reads indented objects written one after another", () => {
    const stream = `${JSON.stringify(config, null, 2)}\n${JSON.stringify({ progress: { message: "Scanning {your} code" } }, null, 2)}\n`;

    assert.deepEqual(splitJsonStream(stream), [
      config,
      { progress: { message: "Scanning {your} code" } },
    ]);
  });

  it("keeps a quote or a brace escaped inside a string", () => {
    assert.deepEqual(splitJsonStream(String.raw`{"a":"\"}{\\"}{"b":1}`), [
      { a: '"}{\\' },
      { b: 1 },
    ]);
  });

  it("refuses output cut off inside a message", () => {
    assert.throws(() => splitJsonStream('{"config": {'), /ends inside/u);
  });

  it("refuses text between messages", () => {
    assert.throws(() => splitJsonStream('{"a":1} oops {"b":2}'), /unexpected/u);
  });
});

describe("readFindings", () => {
  it("reports a finding whose trace reaches a function, outermost call first", () => {
    const findings = readFindings([
      config,
      osv("GO-2026-6865", "Panic on two-block frames"),
      finding("GO-2026-6865", symbolTrace),
    ]);

    assert.deepEqual(findings, [reachable]);
  });

  it("leaves out the module and package levels, which nothing calls", () => {
    const findings = readFindings([
      config,
      osv("GO-2026-0001", "Required only"),
      finding("GO-2026-0001", [
        frame({ module: "example.com/required", version: "v1.0.0" }),
      ]),
      finding("GO-2026-0001", [
        frame({
          module: "example.com/required",
          package: "example.com/required/pkg",
          version: "v1.0.0",
        }),
      ]),
    ]);

    assert.deepEqual(findings, []);
  });

  it("reports an advisory once, with the first trace given for it", () => {
    const findings = readFindings([
      config,
      osv("GO-2026-6865", "Panic on two-block frames"),
      finding("GO-2026-6865", symbolTrace),
      finding("GO-2026-6865", [
        frame({
          function: "Decompress",
          module: "github.com/klauspost/compress",
          package: "github.com/klauspost/compress/fse",
          version: "v1.19.1",
        }),
      ]),
    ]);

    assert.deepEqual(findings, [reachable]);
  });

  it("reports a standard library finding with no fixed version", () => {
    const [stdlib] = readFindings([
      config,
      finding(
        "GO-2026-0002",
        [
          frame({
            function: "Parse",
            module: "stdlib",
            package: "net/url",
            version: "v1.27.3",
          }),
        ],
        ""
      ),
    ]);

    assert.equal(stdlib?.module, "stdlib");
    assert.equal(stdlib?.fixedVersion, undefined);
    assert.deepEqual(stdlib?.callStack, ["net/url.Parse"]);
  });

  it("refuses output with no config message", () => {
    assert.throws(
      () => readFindings([finding("GO-2026-6865", symbolTrace)]),
      /no config message/u
    );
  });
});

describe("readIgnoreFile", () => {
  it("reads an entry with an id, a reason, and an expiry", () => {
    const { entries, problems } = readIgnoreFile(
      JSON.stringify({
        ignore: [
          { expires: "2026-12-08", id: "GO-2026-6865", reason: "Accepted." },
        ],
      }),
      FILE
    );

    assert.deepEqual(problems, []);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.id, "GO-2026-6865");
    assert.equal(entries[0]?.expires.toString(), "2026-12-08");
  });

  it("refuses an entry without a reason or an expiry", () => {
    const { entries, problems } = readIgnoreFile(
      JSON.stringify({
        ignore: [
          { id: "GO-2026-6865", reason: "  " },
          { expires: "2026-02-30", id: "GO-2026-0001", reason: "Accepted." },
          { expires: "12/08/2026", id: "GO-2026-0002", reason: "Accepted." },
        ],
      }),
      FILE
    );

    assert.deepEqual(entries, []);
    assert.deepEqual(
      problems.map(({ message }) => message),
      [
        "GO-2026-6865 needs a `reason` saying why it is accepted",
        "GO-2026-6865 needs an `expires` date, YYYY-MM-DD",
        "GO-2026-0001 needs an `expires` date, YYYY-MM-DD",
        "GO-2026-0002 needs an `expires` date, YYYY-MM-DD",
      ]
    );
  });

  it("refuses an id that is not a Go advisory, and one listed twice", () => {
    const valid = { expires: "2026-12-08", reason: "Accepted." };

    const { entries, problems } = readIgnoreFile(
      JSON.stringify({
        ignore: [
          { ...valid, id: "CVE-2026-116591" },
          { ...valid, id: "GO-2026-6865" },
          { ...valid, id: "GO-2026-6865" },
        ],
      }),
      FILE
    );

    assert.deepEqual(
      entries.map(({ id }) => id),
      ["GO-2026-6865"]
    );
    assert.deepEqual(
      problems.map(({ message }) => message),
      [
        "entry 1 needs an `id` of the form GO-YYYY-NNNN",
        "GO-2026-6865 is listed twice",
      ]
    );
  });

  it("refuses a file that is not an object with an ignore array", () => {
    assert.match(
      readIgnoreFile("[]", FILE).problems[0]?.message ?? "",
      /`ignore` array/u
    );
    assert.match(
      readIgnoreFile("{", FILE).problems[0]?.message ?? "",
      /not JSON/u
    );
  });
});

describe("evaluate", () => {
  it("fails on a finding no entry lists, naming the fix and the calls", () => {
    const report = evaluate([reachable], [], { file: FILE, today });

    assert.equal(report.errors.length, 1);
    assert.match(
      report.errors[0]?.message ?? "",
      /^GO-2026-6865: Panic on two-block frames \(github\.com\/klauspost\/compress@v1\.19\.1, fixed in v1\.20\.2; https:\/\/pkg\.go\.dev\/vuln\/GO-2026-6865\), reached through .*SendRenderedEmail → .*Compress1X$/u
    );
  });

  it("passes a finding an entry lists, through the day it expires", () => {
    const report = evaluate(
      [reachable],
      [entry("GO-2026-6865", "2026-11-08")],
      { file: FILE, today }
    );

    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.ignored, [reachable]);
  });

  it("fails from the day after the expiry, even with the finding gone", () => {
    for (const findings of [[reachable], []]) {
      const report = evaluate(findings, [entry("GO-2026-6865", "2026-11-07")], {
        file: FILE,
        today,
      });

      assert.equal(report.errors.length, 1);
      assert.equal(report.errors[0]?.file, FILE);
      assert.match(report.errors[0]?.message ?? "", /expired on 2026-11-07/u);
      assert.deepEqual(report.ignored, []);
    }
  });

  it("warns about an entry no finding needs any more", () => {
    const report = evaluate([], [entry("GO-2026-6865", "2026-12-08")], {
      file: FILE,
      today,
    });

    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.warnings, [
      {
        file: FILE,
        message: "GO-2026-6865 is no longer reached; delete its entry",
      },
    ]);
  });

  it("fails on a finding the base branch does not reach", () => {
    const report = evaluate([reachable], [], {
      base: new Set(["GO-2026-0001"]),
      file: FILE,
      today,
    });

    assert.equal(report.errors.length, 1);
    assert.deepEqual(report.warnings, []);
  });

  it("warns about a finding the base branch reaches too, without failing", () => {
    const report = evaluate([reachable], [], {
      base: new Set(["GO-2026-6865"]),
      file: FILE,
      today,
    });

    assert.deepEqual(report.errors, []);
    assert.equal(report.warnings.length, 1);
    assert.match(
      report.warnings[0]?.message ?? "",
      /^GO-2026-6865: .*The base branch reaches it too/u
    );
  });

  it("fails on an expired entry even when the base branch reaches its finding", () => {
    const report = evaluate(
      [reachable],
      [entry("GO-2026-6865", "2026-11-07")],
      {
        base: new Set(["GO-2026-6865"]),
        file: FILE,
        today,
      }
    );

    assert.equal(report.errors.length, 1);
    assert.match(report.errors[0]?.message ?? "", /expired on 2026-11-07/u);
  });

  it("passes when nothing is reached and nothing is listed", () => {
    assert.deepEqual(evaluate([], [], { file: FILE, today }), {
      errors: [],
      ignored: [],
      warnings: [],
    });
  });
});
