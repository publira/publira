import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { woffCodePoints } from "./woff-character-map";

const require = createRequire(import.meta.url);

const face = (file: string) => readFile(require.resolve(`@fontsource/${file}`));

describe("woffCodePoints", () => {
  it("reads the characters a subset maps with format 4", async () => {
    const codePoints = woffCodePoints(
      await face("noto-sans/files/noto-sans-latin-700-normal.woff")
    );

    expect(codePoints.has(0x20)).toBe(true);
    expect(codePoints.has("A".codePointAt(0) ?? 0)).toBe(true);
    expect(codePoints.has(0x30_42)).toBe(false);
  });

  it("leaves out a character the subset's unicode-range names but it does not draw", async () => {
    // `unicode.json` lists both under the same Traditional Chinese subset.
    const codePoints = woffCodePoints(
      await face("noto-sans-tc/files/noto-sans-tc-117-700-normal.woff")
    );

    expect(codePoints.has("籤".codePointAt(0) ?? 0)).toBe(true);
    expect(codePoints.has("简".codePointAt(0) ?? 0)).toBe(false);
  });

  it("reads the characters beyond the BMP a format 12 subtable maps", async () => {
    const codePoints = woffCodePoints(
      await face("noto-sans-jp/files/noto-sans-jp-0-700-normal.woff")
    );

    expect([...codePoints].some((codePoint) => codePoint > 0xff_ff)).toBe(true);
  });

  it("refuses a file that is not WOFF", () => {
    expect(() => woffCodePoints(new Uint8Array(64))).toThrow("not a WOFF font");
  });
});
