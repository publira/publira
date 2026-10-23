import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { scan } from "./check-jsx-svg.ts";

const SVG = '<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z" /></svg>';

describe("scan", () => {
  let repository = "";

  const write = async (file: string, source: string): Promise<void> => {
    await mkdir(path.dirname(path.join(repository, file)), { recursive: true });
    await writeFile(path.join(repository, file), source);
  };

  const git = (...args: string[]): void => {
    execFileSync("/usr/bin/git", args, { cwd: repository });
  };

  before(async () => {
    repository = await mkdtemp(path.join(tmpdir(), "check-jsx-svg-"));
    git("init", "--quiet");
    await write(".gitignore", "dist/\n");
    await write(
      "apps/web-admin/src/badge.tsx",
      ["export const Badge = () => (", `  ${SVG}`, ");"].join("\n")
    );
    await write("packages/legacy/src/mark.jsx", SVG);
    await write("packages/icons/src/check.tsx", SVG);
    await write("packages/ui-components/src/qr-code/qr-code.tsx", SVG);
    // Markup inside a string is not JSX, and only .tsx and .jsx files hold JSX.
    await write("packages/ui/src/sanitize.ts", `const allowed = "${SVG}";`);
    await write("packages/ui/dist/badge.tsx", SVG);
    git("add", "--all");
    // Left untracked: a component written but not committed yet.
    await write("apps/web-storefront/src/logo.tsx", SVG);
  });

  after(async () => {
    await rm(repository, { force: true, recursive: true });
  });

  it("reports every <svg> outside the allowed paths, untracked files included", async () => {
    const findings = await scan(repository);

    assert.deepEqual(
      findings.toSorted((a, b) => a.file.localeCompare(b.file)),
      [
        { file: "apps/web-admin/src/badge.tsx", line: 2 },
        { file: "apps/web-storefront/src/logo.tsx", line: 1 },
        { file: "packages/legacy/src/mark.jsx", line: 1 },
      ]
    );
  });

  it("reports nothing once the remaining <svg> are in the allowed paths", async () => {
    await rm(path.join(repository, "apps"), { force: true, recursive: true });
    await rm(path.join(repository, "packages", "legacy"), {
      force: true,
      recursive: true,
    });

    assert.deepEqual(await scan(repository), []);
  });
});
