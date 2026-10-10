import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BaseLookup, ChangedFile } from "./upgrade-notes.ts";
import {
  declaresNone,
  environmentChanges,
  isInstallSource,
  readUpgradeNotes,
  renderReleaseNotes,
  watchedChanges,
} from "./upgrade-notes.ts";

const TEMPLATE_SECTION = [
  "## Upgrade notes",
  "",
  "<!--",
  "What an operator has to do.",
  "## Not a heading inside a comment",
  "-->",
  "",
].join("\n");

/** A base branch that names no variable anywhere. */
const nowhere: BaseLookup = () => new Map();

const lookupFrom =
  (base: Record<string, Record<string, number>>): BaseLookup =>
  (name) =>
    new Map(Object.entries(base[name] ?? {}));

describe("readUpgradeNotes", () => {
  it("returns undefined for a body without the section", () => {
    assert.equal(readUpgradeNotes("## Summary\n\nText."), undefined);
    assert.equal(readUpgradeNotes(null), undefined);
  });

  it("returns an empty string for the section left as the template has it", () => {
    const body = `## Summary\n\nText.\n\n${TEMPLATE_SECTION}\n## Checklist\n\n- [x] Done`;

    assert.equal(readUpgradeNotes(body), "");
  });

  it("returns the text up to the next heading of the same level", () => {
    const body = [
      "## Upgrade notes",
      "",
      "Set `PUBLIRA_FOO` before starting `publira server`.",
      "",
      "### Details",
      "",
      "It names the bucket.",
      "",
      "## Checklist",
      "",
      "- [x] Done",
    ].join("\r\n");

    assert.equal(
      readUpgradeNotes(body),
      "Set `PUBLIRA_FOO` before starting `publira server`.\n\n### Details\n\nIt names the bucket."
    );
  });

  it("matches the heading whatever its case", () => {
    assert.equal(readUpgradeNotes("## upgrade Notes\n\nNone."), "None.");
  });
});

describe("declaresNone", () => {
  it("accepts None with or without a period", () => {
    for (const notes of ["None.", "none", " NONE. "]) {
      assert.equal(declaresNone(notes), true, notes);
    }
  });

  it("rejects anything that says more", () => {
    assert.equal(declaresNone("None, but restart the proxy."), false);
  });
});

describe("isInstallSource", () => {
  it("keeps what ships in an install", () => {
    for (const path of [
      "server/config/runtime.go",
      "apps/web-host/next.config.ts",
      "packages/api-client/src/index.ts",
      "infra/deploy/compose.yaml",
      "infra/deploy/.env.example",
    ]) {
      assert.equal(isInstallSource(path), true, path);
    }
  });

  it("drops tests, documentation, and the development tooling", () => {
    for (const path of [
      "server/config/runtime_test.go",
      "apps/web-host/lib/env.test.ts",
      "server/internal/foo/testdata/env.txt",
      "infra/deploy/README.md",
      "scripts/dev-env.sh",
      "e2e/playwright.config.ts",
    ]) {
      assert.equal(isInstallSource(path), false, path);
    }
  });
});

describe("environmentChanges", () => {
  it("reports a name the base branch does not have", () => {
    const files: ChangedFile[] = [
      {
        filename: "server/config/runtime.go",
        patch: '@@ -1 +1,2 @@\n x := 1\n+v := os.Getenv("PUBLIRA_NEW_THING")',
        status: "modified",
      },
    ];

    assert.deepEqual(environmentChanges(files, nowhere), {
      added: ["PUBLIRA_NEW_THING"],
      removed: [],
    });
  });

  it("ignores a new read of a name the base branch already reads", () => {
    const files: ChangedFile[] = [
      {
        filename: "server/cmd/publiractl/db.go",
        patch: '@@ -1 +1,2 @@\n x := 1\n+v := os.Getenv("PUBLIRA_DB_URL")',
        status: "modified",
      },
    ];
    const lookup = lookupFrom({
      PUBLIRA_DB_URL: { "server/cmd/publiractl/db_roles.go": 1 },
    });

    assert.deepEqual(environmentChanges(files, lookup), {
      added: [],
      removed: [],
    });
  });

  it("reports a name whose every line the diff removes", () => {
    const files: ChangedFile[] = [
      {
        filename: "server/config/runtime.go",
        patch: '@@ -1,2 +1 @@\n x := 1\n-v := os.Getenv("PUBLIRA_OLD_THING")',
        status: "modified",
      },
      {
        filename: "infra/deploy/.env.example",
        patch: "@@ -1,2 +1 @@\n A=1\n-PUBLIRA_OLD_THING=",
        status: "modified",
      },
    ];
    const lookup = lookupFrom({
      PUBLIRA_OLD_THING: {
        "infra/deploy/.env.example": 1,
        "server/config/runtime.go": 1,
      },
    });

    assert.deepEqual(environmentChanges(files, lookup), {
      added: [],
      removed: ["PUBLIRA_OLD_THING"],
    });
  });

  it("keeps a name another file of the base branch still reads", () => {
    const files: ChangedFile[] = [
      {
        filename: "server/config/runtime.go",
        patch: '@@ -1,2 +1 @@\n x := 1\n-v := os.Getenv("PUBLIRA_DB_URL")',
        status: "modified",
      },
    ];
    const lookup = lookupFrom({
      PUBLIRA_DB_URL: {
        "server/cmd/publiractl/db.go": 2,
        "server/config/runtime.go": 1,
      },
    });

    assert.deepEqual(environmentChanges(files, lookup).removed, []);
  });

  it("keeps a name the same file still reads on a line the diff leaves", () => {
    const files: ChangedFile[] = [
      {
        filename: "server/config/runtime.go",
        patch: '@@ -1,2 +1 @@\n x := 1\n-v := os.Getenv("PUBLIRA_DB_URL")',
        status: "modified",
      },
    ];
    const lookup = lookupFrom({
      PUBLIRA_DB_URL: { "server/config/runtime.go": 2 },
    });

    assert.deepEqual(environmentChanges(files, lookup).removed, []);
  });

  it("treats a read moved between files as neither", () => {
    const files: ChangedFile[] = [
      {
        filename: "server/config/a.go",
        patch: '@@ -1,2 +1 @@\n x := 1\n-v := os.Getenv("PUBLIRA_MOVED")',
        status: "modified",
      },
      {
        filename: "server/config/b.go",
        patch: '@@ -1 +1,2 @@\n x := 1\n+v := os.Getenv("PUBLIRA_MOVED")',
        status: "modified",
      },
    ];
    const lookup = lookupFrom({ PUBLIRA_MOVED: { "server/config/a.go": 1 } });

    assert.deepEqual(environmentChanges(files, lookup), {
      added: [],
      removed: [],
    });
  });

  it("finds the lines of a renamed file under its old path", () => {
    const files: ChangedFile[] = [
      {
        filename: "server/config/new.go",
        patch: '@@ -1,2 +1 @@\n x := 1\n-v := os.Getenv("PUBLIRA_GONE")',
        previous_filename: "server/config/old.go",
        status: "renamed",
      },
    ];
    const lookup = lookupFrom({ PUBLIRA_GONE: { "server/config/old.go": 1 } });

    assert.deepEqual(environmentChanges(files, lookup).removed, [
      "PUBLIRA_GONE",
    ]);
  });

  it("ignores names in tests and documentation", () => {
    const files: ChangedFile[] = [
      {
        filename: "server/config/runtime_test.go",
        patch: '@@ -1 +1,2 @@\n x := 1\n+t.Setenv("PUBLIRA_TEST_ONLY", "1")',
        status: "modified",
      },
      {
        filename: "infra/deploy/README.md",
        patch: "@@ -1 +1,2 @@\n x\n+| `PUBLIRA_DOC_ONLY` | text |",
        status: "modified",
      },
    ];

    assert.deepEqual(environmentChanges(files, nowhere), {
      added: [],
      removed: [],
    });
  });
});

describe("watchedChanges", () => {
  it("reports a new migration but not an edit to an old one", () => {
    const files: ChangedFile[] = [
      { filename: "db/migrations/20261010000000_a.up.sql", status: "added" },
      { filename: "db/migrations/20261010000000_a.down.sql", status: "added" },
      { filename: "db/migrations/20260101000000_b.up.sql", status: "modified" },
    ];

    assert.deepEqual(watchedChanges(files, nowhere), [
      "adds the migration db/migrations/20261010000000_a.up.sql",
    ]);
  });

  it("reports a change to the routing but not to its README", () => {
    const files: ChangedFile[] = [
      { filename: "infra/proxy/caddy/Caddyfile", status: "modified" },
      { filename: "infra/proxy/README.md", status: "modified" },
    ];

    assert.deepEqual(watchedChanges(files, nowhere), [
      "changes the routing in infra/proxy/caddy/Caddyfile",
    ]);
  });

  it("reports a change to the database roles", () => {
    const files: ChangedFile[] = [
      { filename: "server/internal/dbroles/dbroles.go", status: "modified" },
    ];

    assert.deepEqual(watchedChanges(files, nowhere), [
      "changes the database roles in server/internal/dbroles/dbroles.go",
    ]);
  });

  it("reports a service added to the Compose file but not an image update", () => {
    const service: ChangedFile = {
      filename: "infra/deploy/compose.yaml",
      patch: "@@ -1 +1,3 @@\n services:\n+  search:\n+    image: opensearch",
      status: "modified",
    };
    const image: ChangedFile = {
      filename: "infra/deploy/compose.yaml",
      patch:
        "@@ -1,2 +1,2 @@\n   proxy:\n-    image: traefik:v3.7.13\n+    image: traefik:v3.7.14",
      status: "modified",
    };

    assert.deepEqual(watchedChanges([service], nowhere), [
      "adds or removes a service, a secret, or a volume in infra/deploy/compose.yaml",
    ]);
    assert.deepEqual(watchedChanges([image], nowhere), []);
  });

  it("reports nothing for a change no operator acts on", () => {
    const files: ChangedFile[] = [
      {
        filename: "apps/web-host/app/page.tsx",
        patch: "@@ -1 +1 @@\n-<p>a</p>\n+<p>b</p>",
        status: "modified",
      },
    ];

    assert.deepEqual(watchedChanges(files, nowhere), []);
  });
});

describe("renderReleaseNotes", () => {
  it("collects every section that asks something, oldest first", () => {
    const notes = renderReleaseNotes(
      [
        {
          body: "## Upgrade notes\n\nRestart the proxy.\n\n## Checklist",
          number: 20,
          title: "fix(proxy): route /feeds",
        },
        { body: "## Upgrade notes\n\nNone.", number: 15, title: "feat: a" },
        { body: TEMPLATE_SECTION, number: 16, title: "feat: b" },
        { body: null, number: 17, title: "chore(deps): c" },
        {
          body: "## Upgrade notes\n\nSet `PUBLIRA_FOO`.",
          number: 10,
          title: "feat(server): read PUBLIRA_FOO",
        },
      ],
      "1.0.0"
    );

    assert.equal(
      notes,
      [
        "## Upgrade notes",
        "",
        "### feat(server): read PUBLIRA_FOO (#10)",
        "",
        "Set `PUBLIRA_FOO`.",
        "",
        "### fix(proxy): route /feeds (#20)",
        "",
        "Restart the proxy.",
        "",
      ].join("\n")
    );
  });

  it("keeps the section when nothing asks anything", () => {
    const notes = renderReleaseNotes(
      [{ body: "## Upgrade notes\n\nNone.", number: 1, title: "feat: a" }],
      "1.0.0"
    );

    assert.match(notes, /^## Upgrade notes\n\nNo change in this release/u);
  });

  it("says there is nothing to upgrade from for the first release", () => {
    const notes = renderReleaseNotes(
      [
        {
          body: "## Upgrade notes\n\nSet `PUBLIRA_FOO`.",
          number: 1,
          title: "a",
        },
      ],
      null
    );

    assert.match(notes, /^## Upgrade notes\n\nThis is the first release/u);
  });
});
