import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import tsdownConfig from "../tsdown.config";

/**
 * An icon reaches its consumers through three lists that have to agree: the
 * barrel, `tsdown`'s build entries, and the `exports` map. A missing build
 * entry or `exports` key breaks only the subpath import, which the barrel
 * import every app uses would never reveal.
 */
const iconModules = readdirSync(new URL(".", import.meta.url))
  .filter((entry) => entry.endsWith("-icon.tsx"))
  .map((entry) => entry.slice(0, -".tsx".length));

const readSource = (name: string): string =>
  readFileSync(new URL(name, import.meta.url), "utf-8");

describe("every icon module", () => {
  it("is re-exported from the barrel", () => {
    const barrel = readSource("./index.ts");

    for (const icon of iconModules) {
      expect(barrel).toContain(`} from "./${icon}";`);
    }
  });

  it("is a tsdown build entry", () => {
    const { entry } = tsdownConfig;

    expect(entry).toEqual(
      expect.arrayContaining(iconModules.map((icon) => `src/${icon}.tsx`))
    );
  });

  it("has an exports subpath, and no subpath names a module that is gone", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf-8")
    ) as { exports: Record<string, unknown> };

    expect(new Set(Object.keys(packageJson.exports))).toEqual(
      new Set([".", ...iconModules.map((icon) => `./${icon}`)])
    );
  });
});
