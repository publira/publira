import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { promisify } from "node:util";

import {
  checkPage,
  collectQuotes,
  headingAnchors,
  scan,
} from "./check-docs.ts";

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

  it("collects the former URLs a page redirects from", () => {
    const { findings, redirects } = checkPage(
      "docs/en/1-page.md",
      page([
        ...VALID,
        "redirect_from:",
        "  - /deployments/reverse-proxy",
        "  - /proxy",
      ])
    );
    assert.deepEqual(findings, []);
    assert.deepEqual(redirects, ["/deployments/reverse-proxy", "/proxy"]);
  });

  it("reports a redirect_from that is not a list of URLs below the version", () => {
    for (const value of [
      "redirect_from: /deployments/reverse-proxy",
      "redirect_from: []",
      "redirect_from: [1]",
    ]) {
      assert.deepEqual(
        messages(page([...VALID, value])),
        [
          "`redirect_from` is not a list of the URLs the page was published at before.",
        ],
        value
      );
    }
    for (const entry of [
      "deployments/reverse-proxy",
      "/deployments/reverse-proxy/",
      "/deployments/reverse-proxy.md",
      "/Deployments/Reverse-Proxy",
    ]) {
      assert.match(
        messages(page([...VALID, `redirect_from: [${entry}]`]))[0] ?? "",
        /is not a URL below the version/u,
        entry
      );
    }
    assert.deepEqual(
      messages(page([...VALID, "redirect_from: [/proxy, /proxy]"])),
      ["`/proxy` is in `redirect_from` twice."]
    );
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

describe("headingAnchors", () => {
  it("lowercases the text and turns each space into a hyphen", () => {
    assert.deepEqual(
      headingAnchors(["# Connection Pools", "", "## Two  spaces"].join("\n")),
      ["connection-pools", "two--spaces"]
    );
  });

  it("keeps the text of inline code and drops its backticks", () => {
    assert.deepEqual(
      headingAnchors("## `PUBLIRA_DB_URL` and `publiractl db`\n"),
      ["publira_db_url-and-publiractl-db"]
    );
  });

  it("drops punctuation and symbols but keeps hyphens and underscores", () => {
    assert.deepEqual(
      headingAnchors(
        [
          "## AI agent trailer: `Assisted-by`, never `Co-authored-by`",
          '## Who? What! (and why) — 100% / 2.0 + C++ & "quotes"',
          "## snake_case and kebab-case",
        ].join("\n")
      ),
      [
        "ai-agent-trailer-assisted-by-never-co-authored-by",
        "who-what-and-why--100--20--c--quotes",
        "snake_case-and-kebab-case",
      ]
    );
  });

  it("keeps letters, marks, and digits outside ASCII", () => {
    assert.deepEqual(
      headingAnchors(
        ["## 著者と投稿者", "## Café Über", "## Ｆｕｌｌ　width"].join("\n")
      ),
      ["著者と投稿者", "café-über", "ｆｕｌｌwidth"]
    );
  });

  it("reads the rendered text of links and emphasis, and not of images or HTML", () => {
    assert.deepEqual(
      headingAnchors(
        "## [The *edge*](./edge.md) <sup>beta</sup> ![logo](./logo.png)\n"
      ),
      ["the-edge-beta-"]
    );
  });

  it("numbers a repeated heading, skipping a suffix a heading took already", () => {
    assert.deepEqual(
      headingAnchors(
        [
          "## Example",
          "## Example",
          "## Example 1",
          "## Example-1",
          "## Example",
        ].join("\n")
      ),
      ["example", "example-1", "example-1-1", "example-1-2", "example-2"]
    );
  });

  it("reads setext headings, and neither frontmatter nor a `#` in code", () => {
    assert.deepEqual(
      headingAnchors(
        [
          "---",
          "name: a-skill",
          "---",
          "",
          "Overview",
          "--------",
          "",
          "```bash",
          "# A shell comment",
          "```",
        ].join("\n")
      ),
      ["overview"]
    );
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

  /** Each finding as `file:line` and the URL it names, the first thing its message quotes. */
  const urls = async (): Promise<string[]> => {
    const reported = await scan(repository);

    return reported.map(
      (finding) =>
        `${finding.file}:${finding.line} ${/^`(?<url>[^`]*)`/u.exec(finding.message)?.groups?.url ?? finding.message}`
    );
  };

  beforeEach(async () => {
    repository = await mkdtemp(path.join(tmpdir(), "check-docs-"));
    // The Markdown outside docs/en/ is listed by Git, as it is in a checkout.
    await promisify(execFile)("git", ["init", "--quiet"], { cwd: repository });
    await write(
      "docs/en/1-getting-started.md",
      page(VALID, ["See [Deployments](./2-deployments/index.md)."])
    );
    await write(
      "docs/en/2-deployments/index.md",
      page(VALID, [
        "## A section",
        "",
        "See [the overview](./1-overview.md#what-an-install-runs) and [the start](../1-getting-started.md).",
        "",
        "![A diagram](./index-diagram.png) and ![the same diagram][diagram]",
        "",
        "[diagram]: ./index-diagram.png",
        "",
        "The [code](https://github.com/publira/publira/blob/main/server/README.md#connection-pools) and [this section](#a-section).",
      ])
    );
    await write(
      "docs/en/2-deployments/1-overview.md",
      page(VALID, ["## What an install runs"])
    );
    await write("docs/en/2-deployments/index-diagram.png", "");
    await write(
      "server/README.md",
      ["# Server", "", "## Connection pools", ""].join("\n")
    );
  });

  afterEach(async () => {
    await rm(repository, { force: true, recursive: true });
  });

  it("passes a tree that follows the contract", async () => {
    assert.deepEqual(await findings(), []);
  });

  it("reports a tree for a locale other than en", async () => {
    await write("docs/ja/1-getting-started.md");
    await write("docs/README.md", "# Documentation\n");

    const reported = await scan(repository);
    assert.deepEqual(
      reported.map((finding) => finding.file),
      ["docs/ja"]
    );
    assert.match(reported[0]?.message ?? "", /English alone until 1\.0\.0/u);
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

  it("passes a page that redirects from a URL no page has", async () => {
    await write(
      "docs/en/2-deployments/2-edge.md",
      page([...VALID, "redirect_from: [/deployments/reverse-proxy]"])
    );

    assert.deepEqual(await findings(), []);
  });

  it("reports a redirect from a page's URL, or one two pages claim", async () => {
    await write(
      "docs/en/2-deployments/2-edge.md",
      page([
        ...VALID,
        "redirect_from: [/deployments/overview, /deployments, /deployments/proxy]",
      ])
    );
    await write(
      "docs/en/3-proxies.md",
      page([...VALID, "redirect_from: [/deployments/proxy]"])
    );

    const reported = await scan(repository);
    assert.deepEqual(
      reported.map((finding) => [finding.file, finding.message]),
      [
        [
          "docs/en/2-deployments/2-edge.md",
          "`/deployments/overview` in `redirect_from` is the URL of docs/en/2-deployments/1-overview.md, which the website serves instead of the redirect.",
        ],
        [
          "docs/en/2-deployments/2-edge.md",
          "`/deployments` in `redirect_from` is the URL of docs/en/2-deployments/index.md, which the website serves instead of the redirect.",
        ],
        [
          "docs/en/2-deployments/2-edge.md",
          "docs/en/3-proxies.md redirects from `/deployments/proxy` too, so the website could send it to only one of the pages.",
        ],
        [
          "docs/en/3-proxies.md",
          "docs/en/2-deployments/2-edge.md redirects from `/deployments/proxy` too, so the website could send it to only one of the pages.",
        ],
      ]
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

  it("reports a link to main in the repository that leads to no file or no heading", async () => {
    const main = "https://github.com/publira/publira/blob/main";
    await write(
      "docs/en/3-upgrading.md",
      page(VALID, [
        `[A missing file](${main}/server/MISSING.md)`,
        "",
        `[A missing heading](${main}/server/README.md#connection-pool)`,
        "",
        `[A heading](${main}/server/README.md#connection-pools)`,
        "",
        `[A line](${main}/server/README.md#L3) and [a directory](https://github.com/publira/publira/tree/main/server)`,
        "",
        `[Raw](${main}/server/README.md?plain=1) and [the root](${main})`,
        "",
        "[Another branch](https://github.com/publira/publira/blob/v0.3.0/server/MISSING.md) and [another host](https://example.com/server/MISSING.md#nowhere)",
      ])
    );

    assert.deepEqual(await urls(), [
      `docs/en/3-upgrading.md:7 ${main}/server/MISSING.md`,
      `docs/en/3-upgrading.md:9 ${main}/server/README.md#connection-pool`,
    ]);
  });

  it("reports a fragment no heading on the page it names produces", async () => {
    await write(
      "docs/en/3-upgrading.md",
      page(VALID, [
        "## Before you start",
        "",
        "[Here](#before-you-start), [nowhere here](#after-you-finish), and [the top](#).",
        "",
        "[There](./2-deployments/1-overview.md#what-an-install-run) and [there](./2-deployments/1-overview.md#what-an-install-runs).",
      ])
    );

    assert.deepEqual(await urls(), [
      "docs/en/3-upgrading.md:9 #after-you-finish",
      "docs/en/3-upgrading.md:11 ./2-deployments/1-overview.md#what-an-install-run",
    ]);
  });

  it("reports a link between the repository's Markdown that leads to no file or no heading", async () => {
    await write(
      "README.md",
      [
        "# Publira",
        "",
        "## Contributing",
        "",
        "[Guide](CONTRIBUTING.md#verifying-a-change) and [the server](server/README.md#connection-pools).",
        "[A missing file](server/MISSING.md) and [a missing heading](server/README.md#pools).",
        "[Here](#contributing), [nowhere here](#licence), and [rooted](/server/README.md#nowhere).",
        "[A directory](server/), [a source file](./server/main.go#L1), and [a heading in one](server/main.go#main).",
        "[Out of the repository](../website/README.md) and [another host](https://example.com/README.md#nowhere).",
        "![A missing image](./logo.png) and [the documentation](docs/en/2-deployments/1-overview.md#what-an-install-runs)",
        "",
        "[missing]: ./MISSING.md",
        "",
        "[A reference][missing]",
        "",
      ].join("\n")
    );
    await write(
      "CONTRIBUTING.md",
      ["# Contributing", "", "## Verifying a change", ""].join("\n")
    );
    await write("server/main.go", "package main\n");
    await write(
      "server/AGENTS.md",
      "[Up](../README.md#publira) and [down](../README.md#publira-1).\n"
    );
    await write(
      "skills/a-skill/SKILL.md",
      [
        "---",
        "name: a-skill",
        "description: Does a thing.",
        "---",
        "",
        "[A reference](references/MISSING.md)",
        "",
      ].join("\n")
    );

    assert.deepEqual(await urls(), [
      "README.md:6 server/MISSING.md",
      "README.md:6 server/README.md#pools",
      "README.md:7 #licence",
      "README.md:7 /server/README.md#nowhere",
      "README.md:9 ../website/README.md",
      "README.md:10 ./logo.png",
      "README.md:12 ./MISSING.md",
      "server/AGENTS.md:1 ../README.md#publira-1",
      "skills/a-skill/SKILL.md:6 references/MISSING.md",
    ]);
  });

  it("leaves vendored skills, dependencies, ignored files, and other Markdown alone", async () => {
    const broken = "[A missing file](./MISSING.md)\n";
    await write(".gitignore", "/build/\n");
    await write(".agents/skills/vendored/SKILL.md", broken);
    await write(".agents/skills/vendored/README.md", broken);
    await write("packages/ui/node_modules/dependency/README.md", broken);
    await write("build/README.md", broken);
    await write(".github/pull_request_template.md", broken);

    assert.deepEqual(await findings(), []);
  });

  it("passes a quote that a page shows as a code block", async () => {
    await write(
      "docs/en/2-deployments/1-overview.md",
      page(VALID, [
        "## What an install runs",
        "",
        "```bash",
        "publiractl db version",
        "```",
      ])
    );
    await write(
      "scripts/restore.sh",
      [
        "#!/usr/bin/env bash",
        'version="$(',
        "  # quoted by docs/en/2-deployments/1-overview.md",
        "  publiractl db version",
        "  # end of quote",
        ')"',
        "",
      ].join("\n")
    );

    assert.deepEqual(await findings(), []);
  });

  it("reports a quote its page does not show, or names no page", async () => {
    await write(
      "scripts/restore.sh",
      [
        "# quoted by docs/en/2-deployments/1-overview.md",
        "publiractl db version",
        "# end of quote",
        "# quoted by docs/en/2-deployments/9-missing.md",
        "publiractl db version",
        "# end of quote",
        "# quoted by server/README.md",
        "publiractl db version",
        "# end of quote",
        "",
      ].join("\n")
    );

    assert.deepEqual(await findings(), [
      "scripts/restore.sh:1",
      "scripts/restore.sh:4",
      "scripts/restore.sh:7",
    ]);
  });
});

describe("collectQuotes", () => {
  it("collects the lines between the comments, without the first one's indentation", () => {
    const { findings, quotes } = collectQuotes(
      "scripts/restore.sh",
      [
        "  # quoted by docs/en/1-page.md",
        "  pg_restore --list publira.dump \\",
        "    > publira.list",
        "",
        "  # end of quote",
      ].join("\n")
    );

    assert.deepEqual(findings, []);
    assert.deepEqual(quotes, [
      {
        line: 1,
        page: "docs/en/1-page.md",
        text: "pg_restore --list publira.dump \\\n  > publira.list\n",
      },
    ]);
  });

  it("reports a quote no end of quote closes", () => {
    const { findings, quotes } = collectQuotes(
      "scripts/restore.sh",
      [
        "# quoted by docs/en/1-page.md",
        "publiractl db version",
        "# quoted by docs/en/1-page.md",
        "publiractl storage test",
        "# end of quote",
        "# quoted by docs/en/1-page.md",
      ].join("\n")
    );

    assert.deepEqual(
      findings.map((finding) => finding.line),
      [1, 6]
    );
    assert.deepEqual(
      quotes.map((quote) => quote.text),
      ["publiractl storage test"]
    );
  });
});
