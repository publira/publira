import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  evaluate,
  fails,
  readFindings,
  readIgnoreFile,
} from "./dependency-vulns.ts";
import type { Finding, IgnoreEntry } from "./dependency-vulns.ts";

const FILE = "osv-scanner.toml";

const CWD = "/repo";

/** One advisory as osv-scanner embeds it in its output. */
const advisory = (
  id: string,
  {
    fixed = "4.17.21",
    name = "lodash",
    rating,
  }: { fixed?: string; name?: string; rating?: string } = {}
) => {
  const unrated = {
    affected: [
      {
        package: { ecosystem: "npm", name },
        ranges: [{ events: [{ introduced: "0" }, { fixed }], type: "SEMVER" }],
      },
    ],
    id,
    summary: `Summary of ${id}`,
  };

  return rating === undefined
    ? unrated
    : { ...unrated, database_specific: { severity: rating } };
};

const output = (packages: unknown[], sourcePath = "/repo/pnpm-lock.yaml") => ({
  results: [{ packages, source: { path: sourcePath, type: "lockfile" } }],
});

const lodash = (
  groups: { aliases: string[]; ids: string[]; max_severity: string }[],
  vulnerabilities: unknown[]
) => ({
  groups,
  package: { ecosystem: "npm", name: "lodash", version: "4.17.20" },
  vulnerabilities,
});

const finding = (overrides: Partial<Finding> = {}): Finding => ({
  aliases: ["GHSA-35jh-r3h4-6jhm", "CVE-2021-23337"],
  ecosystem: "npm",
  fixedVersions: ["4.17.21"],
  id: "GHSA-35jh-r3h4-6jhm",
  lockfile: "pnpm-lock.yaml",
  packageName: "lodash",
  rating: "HIGH",
  score: 7.2,
  summary: "Command Injection in lodash",
  version: "4.17.20",
  ...overrides,
});

const entry = (id: string, expires: string): IgnoreEntry => ({
  expires: Temporal.PlainDate.from(expires),
  id,
  reason: "Accepted until the upgrade lands.",
});

const today = Temporal.PlainDate.from("2026-11-08");

describe("readFindings", () => {
  it("reads one finding per advisory group, with its score, rating, and fix", () => {
    const findings = readFindings(
      output([
        lodash(
          [
            {
              aliases: ["CVE-2021-23337", "GHSA-35jh-r3h4-6jhm"],
              ids: ["GHSA-35jh-r3h4-6jhm"],
              max_severity: "7.2",
            },
          ],
          [advisory("GHSA-35jh-r3h4-6jhm", { rating: "HIGH" })]
        ),
      ]),
      CWD
    );

    assert.deepEqual(findings, [
      {
        aliases: ["GHSA-35jh-r3h4-6jhm", "CVE-2021-23337"],
        ecosystem: "npm",
        fixedVersions: ["4.17.21"],
        id: "GHSA-35jh-r3h4-6jhm",
        lockfile: "pnpm-lock.yaml",
        packageName: "lodash",
        rating: "HIGH",
        score: 7.2,
        summary: "Summary of GHSA-35jh-r3h4-6jhm",
        version: "4.17.20",
      },
    ]);
  });

  it("names the lock file relative to the working directory", () => {
    const [found] = readFindings(
      output(
        [
          {
            groups: [{ aliases: [], ids: ["GHSA-a"], max_severity: "" }],
            package: { ecosystem: "Pub", name: "http", version: "0.13.0" },
            vulnerabilities: [],
          },
        ],
        "/repo/mobile/pubspec.lock"
      ),
      CWD
    );

    assert.equal(found?.lockfile, "mobile/pubspec.lock");
    assert.equal(found?.ecosystem, "Pub");
  });

  it("leaves the score out when the group carries none", () => {
    const [found] = readFindings(
      output([
        lodash(
          [{ aliases: [], ids: ["GHSA-a"], max_severity: "" }],
          [advisory("GHSA-a", { rating: "MODERATE" })]
        ),
      ]),
      CWD
    );

    assert.equal(found?.score, undefined);
    assert.equal(found?.rating, "MODERATE");
  });

  it("keeps only the fixes of the scanned package", () => {
    const [found] = readFindings(
      output([
        lodash(
          [{ aliases: [], ids: ["GHSA-a"], max_severity: "9.8" }],
          [
            {
              affected: [
                {
                  package: { ecosystem: "npm", name: "lodash" },
                  ranges: [{ events: [{ fixed: "4.17.21" }], type: "SEMVER" }],
                },
                {
                  package: { ecosystem: "npm", name: "lodash-es" },
                  ranges: [{ events: [{ fixed: "1.0.0" }], type: "SEMVER" }],
                },
              ],
              id: "GHSA-a",
            },
          ]
        ),
      ]),
      CWD
    );

    assert.deepEqual(found?.fixedVersions, ["4.17.21"]);
  });

  it("reads output with nothing found", () => {
    assert.deepEqual(readFindings({ results: [] }, CWD), []);
  });

  it("refuses something that is not osv-scanner output", () => {
    assert.throws(() => readFindings({ vulns: [] }, CWD), /results/u);
  });
});

describe("fails", () => {
  it("fails from a CVSS score of 7.0", () => {
    assert.equal(fails(finding({ score: 7 })), true);
    assert.equal(fails(finding({ score: 9.8 })), true);
  });

  it("passes below a CVSS score of 7.0, whatever the rating says", () => {
    assert.equal(fails(finding({ rating: "HIGH", score: 6.9 })), false);
  });

  it("falls back to GitHub's rating when no score is given", () => {
    assert.equal(
      fails(finding({ rating: "CRITICAL", score: undefined })),
      true
    );
    assert.equal(fails(finding({ rating: "HIGH", score: undefined })), true);
    assert.equal(
      fails(finding({ rating: "MODERATE", score: undefined })),
      false
    );
    assert.equal(fails(finding({ rating: "LOW", score: undefined })), false);
  });

  it("fails an advisory with neither a score nor a rating", () => {
    assert.equal(fails(finding({ rating: undefined, score: undefined })), true);
  });
});

describe("readIgnoreFile", () => {
  it("reads an entry with an id, a reason, and a date", () => {
    const { entries, problems } = readIgnoreFile(
      `[[IgnoredVulns]]
id = "GHSA-35jh-r3h4-6jhm"
ignoreUntil = 2026-12-01
reason = "No release fixes it yet."
`,
      FILE
    );

    assert.deepEqual(problems, []);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.id, "GHSA-35jh-r3h4-6jhm");
    assert.equal(entries[0]?.expires.toString(), "2026-12-01");
    assert.equal(entries[0]?.reason, "No release fixes it yet.");
  });

  it("reads a file of comments as no entries", () => {
    assert.deepEqual(readIgnoreFile("# nothing accepted\n", FILE), {
      entries: [],
      problems: [],
    });
  });

  it("requires a reason and a date", () => {
    const { entries, problems } = readIgnoreFile(
      `[[IgnoredVulns]]
id = "GHSA-35jh-r3h4-6jhm"
`,
      FILE
    );

    assert.deepEqual(entries, []);
    assert.deepEqual(
      problems.map(({ message }) => message),
      [
        "GHSA-35jh-r3h4-6jhm needs a `reason` saying why it is accepted",
        "GHSA-35jh-r3h4-6jhm needs an `ignoreUntil` date, written as a bare TOML date: ignoreUntil = YYYY-MM-DD",
      ]
    );
  });

  it("refuses a date written as a string or with a time", () => {
    for (const until of ['"2026-12-01"', "2026-12-01T00:00:00Z"]) {
      const { entries, problems } = readIgnoreFile(
        `[[IgnoredVulns]]
id = "GHSA-35jh-r3h4-6jhm"
ignoreUntil = ${until}
reason = "r"
`,
        FILE
      );

      assert.deepEqual(entries, [], until);
      assert.match(problems[0]?.message ?? "", /ignoreUntil/u, until);
    }
  });

  it("refuses a blank reason, a missing id, and an id listed twice", () => {
    const { entries, problems } = readIgnoreFile(
      `[[IgnoredVulns]]
id = "GHSA-a-b"
ignoreUntil = 2026-12-01
reason = "  "

[[IgnoredVulns]]
ignoreUntil = 2026-12-01
reason = "r"

[[IgnoredVulns]]
id = "GHSA-c-d"
ignoreUntil = 2026-12-01
reason = "r"

[[IgnoredVulns]]
id = "GHSA-c-d"
ignoreUntil = 2026-12-02
reason = "r"
`,
      FILE
    );

    assert.deepEqual(
      entries.map(({ id }) => id),
      ["GHSA-c-d"]
    );
    assert.deepEqual(
      problems.map(({ message }) => message),
      [
        "GHSA-a-b needs a `reason` saying why it is accepted",
        "entry 2 needs an `id` naming the advisory, as GHSA-xxxx-xxxx-xxxx or CVE-YYYY-NNNN",
        "GHSA-c-d is listed twice",
      ]
    );
  });

  it("refuses a key the scan does not apply", () => {
    const { problems } = readIgnoreFile(
      `[[IgnoredVulns]]
id = "GHSA-a-b"
ignoreUntil = 2026-12-01
reason = "r"
effectiveUntil = 2026-12-01

[[PackageOverrides]]
name = "lodash"
ignore = true
`,
      FILE
    );

    assert.deepEqual(
      problems.map(({ message }) => message),
      [
        "`PackageOverrides` is not read by the scan: the file holds only [[IgnoredVulns]] entries",
        "GHSA-a-b has `effectiveUntil`, which an entry does not take",
      ]
    );
  });

  it("reports a file that is not TOML", () => {
    const { problems } = readIgnoreFile("[[IgnoredVulns]\n", FILE);

    assert.match(problems[0]?.message ?? "", /^not TOML/u);
    assert.equal(problems[0]?.file, FILE);
  });
});

describe("evaluate", () => {
  it("fails on a high finding the ignore file does not list", () => {
    const report = evaluate([finding()], [], { file: FILE, today });

    assert.equal(report.errors.length, 1);
    assert.match(report.errors[0]?.message ?? "", /^GHSA-35jh-r3h4-6jhm/u);
    assert.match(
      report.errors[0]?.message ?? "",
      /lodash@4\.17\.20 in pnpm-lock\.yaml, CVSS 7\.2, fixed in 4\.17\.21/u
    );
  });

  it("reports a finding below high and passes", () => {
    const low = finding({ score: 5.3 });
    const report = evaluate([low], [], { file: FILE, today });

    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.warnings, []);
    assert.deepEqual(report.below, [low]);
  });

  it("ignores a finding through the day its entry expires", () => {
    const report = evaluate(
      [finding()],
      [entry("GHSA-35jh-r3h4-6jhm", "2026-11-08")],
      { file: FILE, today }
    );

    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.ignored, [finding()]);
  });

  it("matches an entry by an alias of the advisory", () => {
    const report = evaluate(
      [finding()],
      [entry("CVE-2021-23337", "2026-12-01")],
      { file: FILE, today }
    );

    assert.deepEqual(report.errors, []);
    assert.equal(report.ignored.length, 1);
  });

  it("fails on an expired entry, whether or not the finding is still there", () => {
    const expired = entry("GHSA-35jh-r3h4-6jhm", "2026-11-07");

    for (const findings of [[finding()], []]) {
      const report = evaluate(findings, [expired], { file: FILE, today });

      assert.deepEqual(
        report.errors.map(({ file, message }) => ({ file, message })),
        [
          {
            file: FILE,
            message:
              "GHSA-35jh-r3h4-6jhm expired on 2026-11-07: fix it, or judge it again and set a new date. Accepted because: Accepted until the upgrade lands.",
          },
        ]
      );
      assert.deepEqual(report.ignored, []);
    }
  });

  it("fails on an expired entry for a finding below high", () => {
    const report = evaluate(
      [finding({ score: 5.3 })],
      [entry("GHSA-35jh-r3h4-6jhm", "2026-11-07")],
      { file: FILE, today }
    );

    assert.equal(report.errors.length, 1);
  });

  it("warns about an entry no finding needs any more", () => {
    const report = evaluate([], [entry("GHSA-35jh-r3h4-6jhm", "2026-12-01")], {
      file: FILE,
      today,
    });

    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.warnings, [
      {
        file: FILE,
        message: "GHSA-35jh-r3h4-6jhm is no longer found; delete its entry",
      },
    ]);
  });

  it("warns instead of failing on a finding the base carries too", () => {
    const report = evaluate([finding()], [], {
      base: [finding({ version: "4.17.19" })],
      file: FILE,
      today,
    });

    assert.deepEqual(report.errors, []);
    assert.equal(report.warnings.length, 1);
    assert.match(
      report.warnings[0]?.message ?? "",
      /The base carries it too, so this change did not bring it/u
    );
  });

  it("matches the base by an alias of the advisory", () => {
    const report = evaluate([finding()], [], {
      base: [finding({ aliases: ["CVE-2021-23337"], id: "CVE-2021-23337" })],
      file: FILE,
      today,
    });

    assert.deepEqual(report.errors, []);
  });

  it("fails on a finding the base carries in another package only", () => {
    const report = evaluate([finding()], [], {
      base: [finding({ packageName: "lodash-es" })],
      file: FILE,
      today,
    });

    assert.equal(report.errors.length, 1);
  });

  it("fails on the base's advisory in another ecosystem", () => {
    const report = evaluate([finding()], [], {
      base: [finding({ ecosystem: "Pub" })],
      file: FILE,
      today,
    });

    assert.equal(report.errors.length, 1);
  });
});
