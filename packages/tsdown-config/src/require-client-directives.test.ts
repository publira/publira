import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { requireClientDirectives } from "./require-client-directives.ts";

let root: string;
let client: string;
let commented: string;
let server: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "require-client-directives-"));
  client = path.join(root, "client.tsx");
  commented = path.join(root, "commented.tsx");
  server = path.join(root, "server.tsx");
  await writeFile(client, '"use client";\n\nexport const A = 1;\n');
  await writeFile(
    commented,
    '/**\n * A leading doc comment.\n */\n\n"use client";\n\nexport const B = 2;\n'
  );
  await writeFile(server, "export const C = 3;\n");
});

afterAll(async () => {
  await rm(root, { force: true, recursive: true });
});

const chunk = (fileName: string, code: string, moduleIds: string[]) => ({
  code,
  fileName,
  moduleIds,
  type: "chunk" as const,
});

/** Runs the hook; it rejects with the message it failed the build with. */
const run = (
  bundle: Record<string, ReturnType<typeof chunk> | { type: "asset" }>
): Promise<void> =>
  requireClientDirectives().generateBundle.call(
    {
      error: (message: string): never => {
        throw new Error(message);
      },
    },
    {},
    bundle
  );

describe("requireClientDirectives", () => {
  it("fails the build when a client module lands in a chunk without the directive", async () => {
    await expect(
      run({
        "shared.mjs": chunk("shared.mjs", "export const A = 1;\n", [
          server,
          client,
        ]),
      })
    ).rejects.toThrow(
      `"use client" was dropped from 1 module(s):\n${client} -> shared.mjs`
    );
  });

  it("finds the directive after a leading comment", async () => {
    await expect(
      run({ "b.mjs": chunk("b.mjs", "export const B = 2;\n", [commented]) })
    ).rejects.toThrow(`${commented} -> b.mjs`);
  });

  it("passes a chunk that keeps the directive", async () => {
    await expect(
      run({
        "a.mjs": chunk("a.mjs", '"use client";\nexport const A = 1;\n', [
          client,
        ]),
        "b.mjs": chunk("b.mjs", '"use client";\nexport const B = 2;\n', [
          commented,
        ]),
      })
    ).resolves.toBeUndefined();
  });

  it("ignores server modules, declaration files, assets, and virtual modules", async () => {
    await expect(
      run({
        "a.d.mts": chunk("a.d.mts", "export declare const A = 1;\n", [client]),
        "c.mjs": chunk("c.mjs", "export const C = 3;\n", [
          server,
          "\0rolldown/runtime.js",
        ]),
        "style.css": { type: "asset" },
      })
    ).resolves.toBeUndefined();
  });
});
