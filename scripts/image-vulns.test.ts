import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Base, IgnoreEntry, Scan } from "./image-vulns.ts";
import {
  evaluate,
  readBase,
  readIgnoreFile,
  readScan,
  renderSummary,
} from "./image-vulns.ts";

const BASE_LAYER = `sha256:${"a".repeat(64)}`;
const OWN_LAYER = `sha256:${"b".repeat(64)}`;
const COPY_LAYER = `sha256:${"c".repeat(64)}`;

const base: Base = {
  diffIds: [BASE_LAYER],
  digest: `sha256:${"d".repeat(64)}`,
  name: "debian:13.7-slim",
};

interface VulnerabilityInput {
  readonly fixed?: string;
  readonly id: string;
  readonly layer: string;
  readonly pkg?: string;
  readonly severity?: string;
}

const vulnerability = ({
  fixed,
  id,
  layer,
  pkg = "libexample",
  severity = "CRITICAL",
}: VulnerabilityInput) => ({
  // JSON.stringify leaves the field out when it is undefined, as Trivy does
  // for an advisory nothing fixes yet.
  FixedVersion: fixed,
  InstalledVersion: "1.0.0-1",
  Layer: { DiffID: layer, Digest: `sha256:${"e".repeat(64)}` },
  PkgName: pkg,
  PrimaryURL: `https://avd.aquasec.com/nvd/${id.toLowerCase()}`,
  Severity: severity,
  Title: `${pkg}: something bad`,
  VulnerabilityID: id,
});

/** A `trivy image --format json` report of an image of three layers. */
const trivyReport = (
  vulnerabilities: readonly ReturnType<typeof vulnerability>[]
): string =>
  JSON.stringify({
    ArtifactName: "ghcr.io/publira/publira@sha256:0000",
    ArtifactType: "container_image",
    Metadata: {
      DiffIDs: [BASE_LAYER, OWN_LAYER, COPY_LAYER],
      ImageConfig: {
        history: [
          { created_by: "# debian.sh --arch 'amd64' out/ 'trixie'" },
          {
            comment: "buildkit.dockerfile.v0",
            created_by:
              "RUN /bin/sh -c apt-get update  && apt-get install -y libvips42t64 # buildkit",
          },
          {
            comment: "buildkit.dockerfile.v0",
            created_by: "WORKDIR /app",
            empty_layer: true,
          },
          {
            comment: "buildkit.dockerfile.v0",
            created_by: "COPY /out/publira /app/publira # buildkit",
          },
        ],
      },
    },
    Results: [
      {
        Class: "os-pkgs",
        Target: "ghcr.io/publira/publira (debian 13.7)",
        Type: "debian",
        Vulnerabilities: vulnerabilities,
      },
    ],
    SchemaVersion: 2,
  });

const scanOf = (
  ...vulnerabilities: readonly ReturnType<typeof vulnerability>[]
): Scan =>
  readScan(trivyReport(vulnerabilities), "publira (linux/amd64)", base);

const entry = (id: string, expires: string): IgnoreEntry => ({
  expires: Temporal.PlainDate.from(expires),
  id,
  reason: "No fix in trixie yet; lifted by an Issue.",
});

const today = Temporal.PlainDate.from("2026-11-08");
const file = "infra/docker/trivy-ignore.json";

describe("readBase", () => {
  it("reads the base image and its layers", () => {
    assert.deepEqual(readBase(JSON.stringify(base)), base);
  });

  it("refuses a file without the layers", () => {
    assert.throws(
      () => readBase(JSON.stringify({ digest: base.digest, name: base.name })),
      /diffIds/u
    );
  });
});

describe("readScan", () => {
  it("tells a finding in the base image's layers from one in the layers added on top", () => {
    const scan = scanOf(
      vulnerability({ id: "CVE-2026-0001", layer: BASE_LAYER }),
      vulnerability({ id: "CVE-2026-0002", layer: OWN_LAYER })
    );

    assert.equal(scan.layers, 3);
    assert.deepEqual(
      scan.findings.map(({ id, inBase, layer }) => ({
        id,
        inBase,
        position: layer.position,
      })),
      [
        { id: "CVE-2026-0001", inBase: true, position: 1 },
        { id: "CVE-2026-0002", inBase: false, position: 2 },
      ]
    );
  });

  it("names the instruction behind the layer, skipping the history entries that made none", () => {
    const [own, copy] = scanOf(
      vulnerability({ id: "CVE-2026-0001", layer: OWN_LAYER }),
      vulnerability({ id: "GHSA-aaaa-bbbb-cccc", layer: COPY_LAYER })
    ).findings;

    assert.equal(
      own?.layer.createdBy,
      "RUN apt-get update && apt-get install -y libvips42t64"
    );
    assert.equal(copy?.layer.createdBy, "COPY /out/publira /app/publira");
  });

  it("keeps only critical findings, once per package", () => {
    const scan = scanOf(
      vulnerability({ id: "CVE-2026-0001", layer: OWN_LAYER }),
      vulnerability({ id: "CVE-2026-0001", layer: OWN_LAYER }),
      vulnerability({ id: "CVE-2026-0002", layer: OWN_LAYER, severity: "HIGH" })
    );

    assert.deepEqual(
      scan.findings.map(({ id }) => id),
      ["CVE-2026-0001"]
    );
  });

  it("holds a finding in a layer the image does not list to the layers added on top", () => {
    const [finding] = scanOf(
      vulnerability({ id: "CVE-2026-0001", layer: "" })
    ).findings;

    assert.equal(finding?.inBase, false);
    assert.equal(finding?.layer.position, 0);
  });

  it("refuses an image that does not start with its base image's layers", () => {
    assert.throws(
      () =>
        readScan(trivyReport([]), "publira (linux/amd64)", {
          ...base,
          diffIds: [OWN_LAYER],
        }),
      /does not start with the 1 layers of debian:13\.7-slim/u
    );
  });

  it("refuses a report that is not of an image", () => {
    assert.throws(
      () =>
        readScan(
          JSON.stringify({ ArtifactType: "filesystem", Metadata: {} }),
          "publira (linux/amd64)",
          base
        ),
      /not the output of trivy image/u
    );
  });
});

describe("readIgnoreFile", () => {
  it("reads the entries", () => {
    const { entries, problems } = readIgnoreFile(
      JSON.stringify({
        ignore: [
          { expires: "2026-12-08", id: "CVE-2026-0001", reason: "Why." },
          { expires: "2026-12-08", id: "GHSA-aaaa-bbbb-cccc", reason: "Why." },
        ],
      }),
      file
    );

    assert.deepEqual(problems, []);
    assert.deepEqual(
      entries.map(({ expires, id }) => [id, expires.toString()]),
      [
        ["CVE-2026-0001", "2026-12-08"],
        ["GHSA-aaaa-bbbb-cccc", "2026-12-08"],
      ]
    );
  });

  it("names every entry missing an id, a reason, or a real date, and an id listed twice", () => {
    const { entries, problems } = readIgnoreFile(
      JSON.stringify({
        ignore: [
          { expires: "2026-12-08", reason: "Why." },
          { expires: "2026-02-30", id: "CVE-2026-0001", reason: " " },
          { expires: "2026-12-08", id: "CVE-2026-0002", reason: "Why." },
          { expires: "2026-12-08", id: "CVE-2026-0002", reason: "Again." },
          "CVE-2026-0003",
        ],
      }),
      file
    );

    assert.deepEqual(
      entries.map(({ id }) => id),
      ["CVE-2026-0002"]
    );
    assert.deepEqual(
      problems.map(({ message }) => message),
      [
        "entry 1 needs an `id`, the advisory as Trivy reports it, such as CVE-YYYY-NNNN",
        "CVE-2026-0001 needs a `reason` saying why it is accepted",
        "CVE-2026-0001 needs an `expires` date, YYYY-MM-DD",
        "CVE-2026-0002 is listed twice",
        "entry 5 is not an object",
      ]
    );
  });

  it("refuses a file that is not an object with an ignore array", () => {
    assert.deepEqual(readIgnoreFile("[]", file).problems, [
      { file, message: "expected an object with an `ignore` array" },
    ]);
    assert.match(
      readIgnoreFile("{", file).problems[0]?.message ?? "",
      /^not JSON: /u
    );
  });
});

describe("evaluate", () => {
  it("fails on a finding in the layers added on top, naming the image, the layer, and the advisory", () => {
    const report = evaluate(
      [scanOf(vulnerability({ id: "CVE-2026-0002", layer: OWN_LAYER }))],
      [],
      { file, today }
    );

    assert.equal(report.held.length, 1);
    assert.equal(report.errors.length, 1);

    const [error] = report.errors;

    assert.match(error?.message ?? "", /^publira \(linux\/amd64\): /u);
    assert.match(error?.message ?? "", /CVE-2026-0002: libexample/u);
    assert.match(
      error?.message ?? "",
      /layer 2 of 3 \(sha256:bbbbbbbbbbbb…, made by RUN apt-get update/u
    );
  });

  it("reports a finding in the base image's layers without failing", () => {
    const report = evaluate(
      [
        scanOf(
          vulnerability({
            fixed: "1.0.0-2",
            id: "CVE-2026-0001",
            layer: BASE_LAYER,
          })
        ),
      ],
      [],
      { file, today }
    );

    assert.deepEqual(report.errors, []);
    assert.deepEqual(
      report.base.map(({ id }) => id),
      ["CVE-2026-0001"]
    );
    assert.match(
      report.warnings[0]?.message ?? "",
      /fixed in 1\.0\.0-2.*of the base image debian:13\.7-slim/u
    );
  });

  it("suppresses an accepted finding through the day its entry expires", () => {
    const scan = scanOf(
      vulnerability({ id: "CVE-2026-0002", layer: OWN_LAYER })
    );

    const report = evaluate([scan], [entry("CVE-2026-0002", "2026-11-08")], {
      file,
      today,
    });

    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.held, []);
    assert.deepEqual(
      report.ignored.map(({ entry: { id }, finding }) => [id, finding.image]),
      [["CVE-2026-0002", "publira (linux/amd64)"]]
    );
  });

  it("fails on an expired entry, whether or not the finding is still there", () => {
    const report = evaluate(
      [scanOf(vulnerability({ id: "CVE-2026-0002", layer: OWN_LAYER }))],
      [
        entry("CVE-2026-0002", "2026-11-07"),
        entry("CVE-2026-0009", "2026-11-07"),
      ],
      { file, today }
    );

    assert.deepEqual(
      report.errors.map(({ message }) => message.split(":")[0]),
      [
        "CVE-2026-0002 expired on 2026-11-07",
        "CVE-2026-0009 expired on 2026-11-07",
        "publira (linux/amd64)",
      ]
    );
    assert.deepEqual(report.ignored, []);
  });

  it("warns about an entry no image needs any more", () => {
    const report = evaluate(
      [scanOf()],
      [entry("CVE-2026-0009", "2026-12-08")],
      {
        file,
        today,
      }
    );

    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.warnings, [
      {
        file,
        message:
          "CVE-2026-0009 is no longer found in any image; delete its entry",
      },
    ]);
  });
});

describe("renderSummary", () => {
  it("lists what holds the release, what the base images carry, and what is accepted", () => {
    const scans = [
      scanOf(
        vulnerability({ id: "CVE-2026-0001", layer: BASE_LAYER }),
        vulnerability({ id: "CVE-2026-0002", layer: OWN_LAYER }),
        vulnerability({ id: "CVE-2026-0003", layer: COPY_LAYER, pkg: "a|b" })
      ),
    ];

    const summary = renderSummary(
      scans,
      evaluate(scans, [entry("CVE-2026-0003", "2026-12-08")], { file, today })
    );

    assert.match(summary, /### Holding the release\n[^#]*CVE-2026-0002/u);
    assert.match(
      summary,
      /### In the base images\n[^#]*CVE-2026-0001[^\n]*`debian:13\.7-slim` \|/u
    );
    assert.match(
      summary,
      /### Accepted\n[^#]*CVE-2026-0003[^\n]*a\\\|b[^\n]*No fix in trixie yet; lifted by an Issue\. \| 2026-12-08 \|/u
    );
  });

  it("says so when no image carries a critical finding", () => {
    const scans = [scanOf()];

    assert.match(
      renderSummary(scans, evaluate(scans, [], { file, today })),
      /No image carries a critical finding\./u
    );
  });
});
