import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { checkPage, scan } from "./check-docs.ts";

const page = (frontmatter: string[], body: string[] = ["## A section"]) =>
  ["---", ...frontmatter, "---", "", ...body, ""].join("\n");

const VALID = [
  "title: Overview",
  "description: What an install runs.",
  "published: 2026-10-04",
];

const messages = (source: string): string[] =>
  checkPage("docs/en/1-page.md", source).findings.map(
    (finding) => finding.message
  );

describe("checkPage", () => {
  it("accepts a page with every required key", () => {
    assert.deepEqual(messages(page(VALID)), []);
    assert.deepEqual(messages(page([...VALID, "updated: 2026-10-05"])), []);
  });

  it("accepts a quoted value, as YAML allows", () => {
    assert.deepEqual(
      messages(
        page([
          'title: "Upgrading: the release checklist"',
          "description: 'What to run on every release.'",
          'published: "2026-10-04"',
        ])
      ),
      []
    );
  });

  it("reports a page without frontmatter, or with one left open", () => {
    assert.match(messages("## A section\n")[0] ?? "", /frontmatter/u);
    assert.match(
      messages(["---", ...VALID, "", "## A section"].join("\n"))[0] ?? "",
      /no closing/u
    );
  });

  it("reports frontmatter that is not YAML", () => {
    assert.match(
      messages(page(["title: [Overview", ...VALID.slice(1)]))[0] ?? "",
      /not valid YAML/u
    );
  });

  it("reports a missing key, an unknown key, and an empty value", () => {
    assert.deepEqual(messages(page(VALID.slice(0, 2))), [
      "The frontmatter has no `published`.",
    ]);
    assert.match(
      messages(page([...VALID, "publised: 2026-10-04"]))[0] ?? "",
      /`publised` is not a frontmatter key/u
    );
    assert.deepEqual(messages(page(['title: ""', ...VALID.slice(1)])), [
      "`title` is not a single line of text.",
    ]);
  });

  it("reports a date that is not a YYYY-MM-DD day on the calendar", () => {
    for (const published of ["2026-10-4", "2026-02-30", "October 4, 2026"]) {
      assert.deepEqual(
        messages(page([...VALID.slice(0, 2), `published: ${published}`])),
        ["`published` is not a `YYYY-MM-DD` date."],
        published
      );
    }
    assert.deepEqual(messages(page([...VALID, "updated: 2026-13-01"])), [
      "`updated` is not a `YYYY-MM-DD` date.",
    ]);
  });

  it("reports updated earlier than published", () => {
    assert.deepEqual(messages(page([...VALID, "updated: 2026-10-03"])), [
      "`updated` is earlier than `published`.",
    ]);
  });

  it("reports a level-one heading in the body, in either syntax", () => {
    const [atx] = checkPage(
      "docs/en/1-page.md",
      page(VALID, ["# Overview", "", "## A section"])
    ).findings;
    assert.match(atx?.message ?? "", /`#` heading/u);
    // The frontmatter takes five lines and a blank one follows it, so the
    // heading is on line seven of the file, not line one of the body.
    assert.equal(atx?.line, 7);

    assert.match(
      messages(page(VALID, ["Overview", "========"]))[0] ?? "",
      /`#` heading/u
    );
  });

  it("reports an image without alt text, in either syntax", () => {
    const reported = checkPage(
      "docs/en/1-page.md",
      page(VALID, [
        "![](./page-diagram.png)",
        "",
        "![ ][diagram] and ![A diagram][diagram]",
        "",
        "[diagram]: ./page-diagram.png",
      ])
    ).findings;

    assert.deepEqual(
      reported.map((finding) => finding.line),
      [7, 9]
    );
    assert.match(reported[0]?.message ?? "", /no alt text/u);
  });

  it("does not read a `#` inside a code block as a heading", () => {
    assert.deepEqual(
      messages(page(VALID, ["```bash", "# A shell comment", "```"])),
      []
    );
  });

  // A reference link is resolved through its definition, so the definition is
  // the one place its target is checked.
  it("collects every link, definition, and image with its line", () => {
    const { links } = checkPage(
      "docs/en/1-page.md",
      page(VALID, [
        "See [the overview](./2-deployments/1-overview.md).",
        "",
        "| Page | Link |",
        "| --- | --- |",
        "| Deployments | [Deployments][deployments] |",
        "",
        "![A diagram](./diagram.png)",
        "",
        "[deployments]: ./2-deployments/index.md",
      ])
    );

    assert.deepEqual(links, [
      { image: false, line: 7, url: "./2-deployments/1-overview.md" },
      { image: true, line: 13, url: "./diagram.png" },
      { image: false, line: 15, url: "./2-deployments/index.md" },
    ]);
  });

  it("takes a definition as an image or a link by how it is referenced", () => {
    const { links } = checkPage(
      "docs/en/2-deployments/index.md",
      page(VALID, [
        "![A diagram][diagram]",
        "",
        "[The overview][overview], and [the overview again][overview].",
        "",
        "[diagram]: ./diagram.png",
        "[overview]: ./1-overview.md",
        "[unused]: ./nowhere.md",
      ])
    );

    assert.deepEqual(links, [
      { image: true, line: 11, url: "./diagram.png" },
      { image: false, line: 12, url: "./1-overview.md" },
    ]);
  });
});

describe("scan", () => {
  let repository = "";

  const write = async (file: string, source = page(VALID)): Promise<void> => {
    await mkdir(path.dirname(path.join(repository, file)), { recursive: true });
    await writeFile(path.join(repository, file), source);
  };

  /** Each finding as `file` or `file:line`, the way the check prints it. */
  const findings = async (): Promise<string[]> => {
    const reported = await scan(repository);

    return reported.map((finding) =>
      [finding.file, finding.line]
        .filter((part) => part !== undefined)
        .join(":")
    );
  };

  beforeEach(async () => {
    repository = await mkdtemp(path.join(tmpdir(), "check-docs-"));
    await write(
      "docs/en/1-getting-started.md",
      page(VALID, ["See [Deployments](./2-deployments/index.md)."])
    );
    await write(
      "docs/en/2-deployments/index.md",
      page(VALID, [
        "See [the overview](./1-overview.md#what-an-install-runs) and [the start](../1-getting-started.md).",
        "",
        "![A diagram](./index-diagram.png) and ![the same diagram][diagram]",
        "",
        "[diagram]: ./index-diagram.png",
        "",
        "The [code](https://github.com/publira/publira/blob/main/server/README.md) and [this section](#a-section).",
      ])
    );
    await write("docs/en/2-deployments/1-overview.md");
    await write("docs/en/2-deployments/index-diagram.png", "");
  });

  afterEach(async () => {
    await rm(repository, { force: true, recursive: true });
  });

  it("passes a tree that follows the contract", async () => {
    assert.deepEqual(await findings(), []);
  });

  it("reports a name that is not <n>-<slug>", async () => {
    await write("docs/en/getting-started.md");
    await write("docs/en/3-Upgrading.md");
    await write("docs/en/04-backups.md");
    await write("docs/en/5-notes.txt", "");
    await write("docs/en/operations/index.md");

    assert.deepEqual(await findings(), [
      "docs/en/04-backups.md",
      "docs/en/3-Upgrading.md",
      "docs/en/5-notes.txt",
      "docs/en/getting-started.md",
      "docs/en/operations",
    ]);
  });

  it("reports a number or a slug a sibling already has", async () => {
    await write("docs/en/2-upgrading.md");
    await write("docs/en/3-deployments.md");

    const reported = await scan(repository);
    assert.deepEqual(
      reported.map((finding) => finding.file),
      ["docs/en/2-upgrading.md", "docs/en/3-deployments.md"]
    );
    assert.match(reported[0]?.message ?? "", /number 2/u);
    assert.match(reported[1]?.message ?? "", /slug `deployments`/u);
  });

  it("reports a directory without index.md", async () => {
    await write("docs/en/3-operations/1-backups.md");

    const reported = await scan(repository);
    assert.deepEqual(
      reported.map((finding) => finding.file),
      ["docs/en/3-operations"]
    );
    assert.match(reported[0]?.message ?? "", /no `index.md`/u);
  });

  it("reports a page whose frontmatter or heading breaks the format", async () => {
    await write("docs/en/3-upgrading.md", page(VALID.slice(1)));
    await write("docs/en/4-backups.md", page(VALID, ["# Backups"]));

    assert.deepEqual(await findings(), [
      "docs/en/3-upgrading.md:1",
      "docs/en/4-backups.md:7",
    ]);
  });

  it("reports a relative link to a page or an image that does not exist", async () => {
    await write(
      "docs/en/3-upgrading.md",
      page(VALID, [
        "See [the overview](./2-deployments/2-overview.md).",
        "",
        "![A diagram](./missing.png)",
      ])
    );

    const reported = await scan(repository);
    assert.deepEqual(
      reported.map((finding) => `${finding.file}:${finding.line}`),
      ["docs/en/3-upgrading.md:7", "docs/en/3-upgrading.md:9"]
    );
    assert.match(reported[0]?.message ?? "", /does not exist/u);
  });

  it("reports an image that is not a file beside the page", async () => {
    await write(
      "docs/en/3-upgrading.md",
      page(VALID, [
        "![A remote diagram](https://example.com/diagram.png)",
        "",
        "![A fragment](#a-section)",
      ])
    );

    const reported = await scan(repository);
    assert.deepEqual(
      reported.map((finding) => `${finding.file}:${finding.line}`),
      ["docs/en/3-upgrading.md:7", "docs/en/3-upgrading.md:9"]
    );
    assert.match(reported[0]?.message ?? "", /is not a file in docs\/en\//u);
  });

  it("reports an image no page beside it shows", async () => {
    await write("docs/en/2-deployments/overview-unused.png", "");
    // Shown, but from a page in another directory.
    await write("docs/en/2-deployments/overview-elsewhere.png", "");
    await write(
      "docs/en/3-upgrading.md",
      page(VALID, ["![A diagram](./2-deployments/overview-elsewhere.png)"])
    );

    const reported = await scan(repository);
    assert.deepEqual(
      reported.map((finding) => finding.file),
      [
        "docs/en/2-deployments/overview-elsewhere.png",
        "docs/en/2-deployments/overview-unused.png",
      ]
    );
    assert.match(reported[0]?.message ?? "", /No page beside the image/u);
  });

  it("reports an image not named after a page that shows it", async () => {
    const names = [
      "diagram.png",
      "1-overview-diagram.png",
      "overview-.png",
      "overview-Diagram.png",
      "upgrading-diagram.png",
      "deployments-diagram.png",
      // Named after a sibling page that does not show it.
      "index-overview.png",
    ];
    await Promise.all(
      names.map((name) => write(`docs/en/2-deployments/${name}`, ""))
    );
    // Shown by both pages, and named after one of them.
    await write("docs/en/2-deployments/index-shared.png", "");
    await write(
      "docs/en/2-deployments/1-overview.md",
      page(
        VALID,
        [...names, "index-shared.png"].flatMap((name) => [
          `![A diagram](./${name})`,
          "",
        ])
      )
    );
    await write(
      "docs/en/2-deployments/index.md",
      page(VALID, [
        "![A diagram](./index-diagram.png) and ![the same diagram](./index-shared.png)",
      ])
    );

    const reported = await scan(repository);
    assert.deepEqual(
      reported.map((finding) => finding.file),
      names
        .map((name) => `docs/en/2-deployments/${name}`)
        .toSorted((a, b) => a.localeCompare(b, "en"))
    );
    assert.match(
      reported.find((finding) => finding.file.endsWith("/index-overview.png"))
        ?.message ?? "",
      /after a page that shows it \(`overview`\)/u
    );
  });

  it("reports a link the website cannot rewrite", async () => {
    await write(
      "docs/en/3-upgrading.md",
      page(VALID, [
        "[A directory](./2-deployments/)",
        "",
        "[The server](../../server/README.md)",
        "",
        "[Rooted](/docs/en/1-getting-started.md)",
        "",
        "![A page](./1-getting-started.md)",
      ])
    );

    const reported = await scan(repository);
    assert.deepEqual(
      reported.map((finding) =>
        finding.message.split(" ").slice(1, 4).join(" ")
      ),
      ["is not a", "leaves docs/en/, which", "is rooted at", "is not an"]
    );
  });
});
