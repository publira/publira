import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import { findWorktree } from "./worktree-deps.ts";

const SCRIPT = path.join(import.meta.dirname, "worktree-deps.ts");

/**
 * Stands in for `task deps`: prints to stdout, which the hook must keep off its
 * own stdout, and creates `node_modules/` unless told to fail.
 */
const FAKE_TASK = `#!/bin/sh
echo "fake task $*"
if [ -n "$FAKE_TASK_FAIL" ]; then
  exit 3
fi
mkdir node_modules
`;

describe("worktree-deps", () => {
  let base = "";
  let checkout = "";
  let worktree = "";
  let nested = "";
  let bin = "";

  const run = (input: unknown, env: Record<string, string> = {}) =>
    spawnSync(process.execPath, [SCRIPT], {
      encoding: "utf-8",
      env: { ...process.env, ...env, PATH: `${bin}:${process.env.PATH}` },
      input: JSON.stringify(input),
    });

  before(async () => {
    base = await mkdtemp(path.join(tmpdir(), "worktree-deps-"));
    checkout = path.join(base, "publira");
    worktree = path.join(checkout, ".claude", "worktrees", "fix-login");
    nested = path.join(checkout, ".claude", "worktrees", "team", "fix-cart");
    bin = path.join(base, "bin");

    await mkdir(path.join(checkout, ".git"), { recursive: true });
    await Promise.all(
      [worktree, nested].map(async (root) => {
        await mkdir(path.join(root, "apps", "web-admin", "app"), {
          recursive: true,
        });
        await writeFile(path.join(root, ".git"), "gitdir: elsewhere\n");
      })
    );
    await mkdir(bin);
    await writeFile(path.join(bin, "task"), FAKE_TASK, { mode: 0o755 });
  });

  beforeEach(async () => {
    await Promise.all(
      [checkout, worktree, nested].map((root) =>
        rm(path.join(root, "node_modules"), { force: true, recursive: true })
      )
    );
  });

  after(async () => {
    await rm(base, { force: true, recursive: true });
  });

  it("finds the worktree root from a cwd deep inside it", () => {
    assert.equal(
      findWorktree({ cwd: path.join(worktree, "apps", "web-admin", "app") }),
      worktree
    );
  });

  it("finds a worktree whose name holds a slash", () => {
    assert.equal(
      findWorktree({ cwd: path.join(nested, "apps", "web-admin") }),
      nested
    );
  });

  it("falls back to a worktree path mentioned elsewhere in the input", () => {
    assert.equal(
      findWorktree({
        cwd: checkout,
        hook_event_name: "PostToolUse",
        tool_name: "EnterWorktree",
        tool_response: `Created worktree at “${worktree}” on branch “worktree-fix-login”.`,
      }),
      worktree
    );
  });

  it("finds nothing in the main checkout or a worktree added elsewhere", () => {
    assert.equal(findWorktree({ cwd: checkout }), undefined);
    assert.equal(
      findWorktree({ cwd: path.join(base, "publira-1178") }),
      undefined
    );
  });

  it("runs task deps in a worktree without node_modules", () => {
    const result = run({ cwd: path.join(worktree, "apps") });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, `Installed the dependencies of ${worktree}.\n`);
    assert.match(result.stderr, /fake task deps/u);
    assert.ok(existsSync(path.join(worktree, "node_modules")));
  });

  it("runs nothing once node_modules exists", async () => {
    await mkdir(path.join(worktree, "node_modules"));

    const result = run({ cwd: worktree });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  });

  it("runs nothing in the main checkout", () => {
    const result = run({ cwd: checkout, source: "startup" });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.ok(!existsSync(path.join(checkout, "node_modules")));
  });

  it("reports a failed install on stderr with a non-zero exit", () => {
    const result = run({ cwd: worktree }, { FAKE_TASK_FAIL: "1" });

    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /task deps failed in .* \(exit status 3\)/u);
  });
});
