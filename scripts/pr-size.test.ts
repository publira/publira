import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  bucket,
  coefficient,
  isSignificant,
  scoreDiff,
  significantLinesByFile,
} from "./pr-size.ts";

describe("isSignificant", () => {
  it("drops blank lines", () => {
    assert.equal(isSignificant(""), false);
    assert.equal(isSignificant("    "), false);
  });

  it("drops lines that are only delimiters", () => {
    for (const line of ["{", "}", "  });", ")", "],", "};", "(", "[", ";"]) {
      assert.equal(isSignificant(line), false, line);
    }
  });

  it("drops lines that are only a JSX tag", () => {
    for (const line of [
      "</Card>",
      "  <Separator />",
      "<CardHeader>",
      "<>",
      "</>",
      "<Card.Header>",
      "  />",
      "  >",
    ]) {
      assert.equal(isSignificant(line), false, line);
    }
  });

  it("keeps a tag that carries an attribute or a child", () => {
    for (const line of [
      '<Card className="p-4">',
      "<CardTitle>{title}</CardTitle>",
      "  const total = a + b;",
      "-- a SQL comment",
    ]) {
      assert.equal(isSignificant(line), true, line);
    }
  });
});

describe("coefficient", () => {
  it("reads the generated and vendored paths from .gitattributes", () => {
    assert.equal(
      coefficient("server/internal/gen/publira/v1/catalog.pb.go"),
      0
    );
    assert.equal(coefficient("packages/api-client/src/gen/index.ts"), 0);
    assert.equal(coefficient("server/internal/db/gen/models.go"), 0);
    assert.equal(coefficient(".agents/skills/example/SKILL.md"), 0);
  });

  it("scores lock files as nothing", () => {
    assert.equal(coefficient("pnpm-lock.yaml"), 0);
    assert.equal(coefficient("mobile/pubspec.lock"), 0);
    assert.equal(coefficient("skills-lock.json"), 0);
    assert.equal(coefficient(".devcontainer/devcontainer-lock.json"), 0);
  });

  it("ranks a path by what it costs to read", () => {
    assert.equal(coefficient("locales/ja.json"), 0.2);
    assert.equal(coefficient("e2e/fixtures/eye-catch/og-1200x630.jpg"), 0.2);
    assert.equal(coefficient("AGENTS.md"), 0.3);
    assert.equal(coefficient("server/internal/auth/session_test.go"), 0.5);
    assert.equal(coefficient("apps/web-admin/src/lib/form.test.ts"), 0.5);
    assert.equal(coefficient("e2e/tests/reader.spec.ts"), 0.5);
    assert.equal(coefficient("mobile/test/widget_test.dart"), 0.5);
    assert.equal(coefficient(".github/workflows/ci.yml"), 0.7);
    assert.equal(coefficient("apps/web-host/src/app/page.tsx"), 0.9);
    assert.equal(coefficient("server/internal/auth/session.go"), 1);
    assert.equal(coefficient("packages/utils/src/index.ts"), 1);
    assert.equal(coefficient("mobile/lib/main.dart"), 1);
    assert.equal(coefficient("proto/publira/v1/catalog.proto"), 1.5);
    assert.equal(coefficient("db/migrations/20260101000000_init.up.sql"), 1.5);
    assert.equal(coefficient("db/query/episode.sql"), 1.5);
  });

  it("reads an unfamiliar path like source", () => {
    assert.equal(coefficient("scripts/storage-init.sh"), 1);
    assert.equal(coefficient("infra/docker/web.Dockerfile"), 1);
  });

  it("prefers the more specific kind over the one that would swallow it", () => {
    assert.equal(coefficient("apps/web-admin/src/form.test.tsx"), 0.5);
    assert.equal(coefficient("e2e/README.md"), 0.3);
    assert.equal(coefficient("locales/index.json"), 0.2);
  });
});

describe("bucket", () => {
  it("assigns a label by threshold", () => {
    assert.equal(bucket(0), "size/xs");
    assert.equal(bucket(60), "size/xs");
    assert.equal(bucket(60.1), "size/s");
    assert.equal(bucket(200), "size/s");
    assert.equal(bucket(200.1), "size/m");
    assert.equal(bucket(600), "size/m");
    assert.equal(bucket(600.1), "size/l");
    assert.equal(bucket(1600), "size/l");
    assert.equal(bucket(1600.1), "size/xl");
  });
});

describe("significantLinesByFile", () => {
  it("counts added and removed lines together", () => {
    const counts = significantLinesByFile(
      [
        "diff --git a/server/internal/auth/session.go b/server/internal/auth/session.go",
        "--- a/server/internal/auth/session.go",
        "+++ b/server/internal/auth/session.go",
        "@@ -1,3 +1,4 @@",
        " package auth",
        "-const ttl = time.Hour",
        "+const ttl = 2 * time.Hour",
        '+var errExpired = errors.New("expired")',
        "",
      ].join("\n")
    );
    assert.deepEqual([...counts], [["server/internal/auth/session.go", 3]]);
  });

  it("does not mistake removed content for a file header", () => {
    const counts = significantLinesByFile(
      [
        "diff --git a/db/query/episode.sql b/db/query/episode.sql",
        "--- a/db/query/episode.sql",
        "+++ b/db/query/episode.sql",
        "@@ -1,2 +1,2 @@",
        "--- name: GetEpisode :one",
        "+++ name: FindEpisode :one",
        "",
      ].join("\n")
    );
    assert.deepEqual([...counts], [["db/query/episode.sql", 2]]);
  });

  it("attributes a deleted file to the path it had", () => {
    const counts = significantLinesByFile(
      [
        "diff --git a/apps/web-host/src/old.ts b/apps/web-host/src/old.ts",
        "deleted file mode 100644",
        "--- a/apps/web-host/src/old.ts",
        "+++ /dev/null",
        "@@ -1,1 +0,0 @@",
        "-export const gone = true;",
        "",
      ].join("\n")
    );
    assert.deepEqual([...counts], [["apps/web-host/src/old.ts", 1]]);
  });

  it("records a rename with no hunks as zero lines", () => {
    const counts = significantLinesByFile(
      [
        "diff --git a/a.ts b/b.ts",
        "similarity index 100%",
        "rename from a.ts",
        "rename to b.ts",
        "",
      ].join("\n")
    );
    assert.deepEqual([...counts], []);
  });
});

describe("scoreDiff", () => {
  it("scores a generated-only diff as nothing", () => {
    const diff = [
      "diff --git a/server/internal/gen/publira/v1/catalog.pb.go b/server/internal/gen/publira/v1/catalog.pb.go",
      "--- a/server/internal/gen/publira/v1/catalog.pb.go",
      "+++ b/server/internal/gen/publira/v1/catalog.pb.go",
      "@@ -1,2 +1,2 @@",
      "-// protoc-gen-go v1.36.0",
      "+// protoc-gen-go v1.37.0",
      "diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml",
      "--- a/pnpm-lock.yaml",
      "+++ b/pnpm-lock.yaml",
      "@@ -1,2 +1,2 @@",
      "-  version: 1.0.0",
      "+  version: 1.0.1",
      "",
    ].join("\n");
    const { score } = scoreDiff(diff);
    assert.equal(score, 0);
    assert.equal(bucket(score), "size/xs");
  });

  it("counts a re-indented JSX subtree as the lines that actually changed", () => {
    const diff = [
      "diff --git a/apps/web-admin/src/card.tsx b/apps/web-admin/src/card.tsx",
      "--- a/apps/web-admin/src/card.tsx",
      "+++ b/apps/web-admin/src/card.tsx",
      "@@ -1,5 +1,5 @@",
      "-  <Card>",
      "-    <CardHeader>",
      "-      <CardTitle>{title}</CardTitle>",
      "-    </CardHeader>",
      "-  </Card>",
      "+<Card>",
      "+  <CardHeader>",
      "+    <CardTitle>{title}</CardTitle>",
      "+  </CardHeader>",
      "+</Card>",
      "",
    ].join("\n");
    assert.deepEqual(scoreDiff(diff), {
      files: [
        {
          coefficient: 0.9,
          file: "apps/web-admin/src/card.tsx",
          score: 1.8,
          significantLines: 2,
        },
      ],
      score: 1.8,
    });
  });

  it("weighs each file by its own coefficient", () => {
    const diff = [
      "diff --git a/proto/publira/v1/catalog.proto b/proto/publira/v1/catalog.proto",
      "--- a/proto/publira/v1/catalog.proto",
      "+++ b/proto/publira/v1/catalog.proto",
      "@@ -1,1 +1,2 @@",
      "+  string comment_mode = 4;",
      "+  string previous_token = 5;",
      "diff --git a/README.md b/README.md",
      "--- a/README.md",
      "+++ b/README.md",
      "@@ -1,1 +1,2 @@",
      "+Comments are opt-in per tenant.",
      "",
    ].join("\n");
    assert.equal(scoreDiff(diff).score, 3.3);
  });
});
