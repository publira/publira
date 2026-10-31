import { describe, expect, it } from "vitest";

import { loadOpenGraphCardFonts } from "./open-graph-card-fonts";

const fontNames = async (
  locale: Parameters<typeof loadOpenGraphCardFonts>[0],
  text: string
) => {
  const { fonts } = await loadOpenGraphCardFonts(locale, [text]);

  return fonts.map(({ name }) => name);
};

describe("loadOpenGraphCardFonts", () => {
  it("sets an English card in Noto Sans alone", async () => {
    expect(await fontNames("en", "Seed Series 001")).toEqual([
      "noto-sans-latin",
    ]);
  });

  it.each([
    ["ja", "進撃の物語", "noto-sans-jp-"],
    ["ko", "한국어 제목", "noto-sans-kr-"],
    ["zh-Hans", "简体中文标题", "noto-sans-sc-"],
    ["zh-Hant", "繁體中文標題", "noto-sans-tc-"],
  ] as const)(
    "draws a %s title from that locale's own face",
    async (locale, text, prefix) => {
      const names = await fontNames(locale, text);

      expect(names.length).toBeGreaterThan(0);

      for (const name of names) {
        expect(name.startsWith(prefix)).toBe(true);
      }
    }
  );

  it("draws Han characters in their regional form for each locale", async () => {
    const [ja, zhHant] = await Promise.all([
      fontNames("ja", "漫画"),
      fontNames("zh-Hant", "漫画"),
    ]);

    expect(ja.every((name) => name.startsWith("noto-sans-jp-"))).toBe(true);
    expect(zhHant.every((name) => name.startsWith("noto-sans-tc-"))).toBe(true);
  });

  it("borrows a face for a script the locale's own lacks", async () => {
    const names = await fontNames("en", "Seoul 서울");

    // Noto Sans JP, the first face after English's own, has no Hangul.
    expect(names[0]).toBe("noto-sans-latin");
    expect(names.slice(1).length).toBeGreaterThan(0);
    expect(
      names.slice(1).every((name) => name.startsWith("noto-sans-kr-"))
    ).toBe(true);
  });

  it("passes over a face whose table lists a character it does not draw", async () => {
    // Noto Sans TC's `unicode.json` files 简 under a subset that has no glyph
    // for it; Noto Sans SC draws it.
    const names = await fontNames("zh-Hant", "简");

    expect(names).toHaveLength(1);
    expect(names[0]?.startsWith("noto-sans-sc-")).toBe(true);
  });

  it("reads only the subsets the text falls in", async () => {
    const { fonts } = await loadOpenGraphCardFonts("ja", ["あ"]);

    expect(fonts).toHaveLength(1);
    expect(fonts[0]).toMatchObject({ style: "normal", weight: 700 });
    expect(fonts[0]?.data.byteLength).toBeGreaterThan(0);
  });

  it("leaves out what no shipped face covers, and keeps the spaces", async () => {
    const { texts } = await loadOpenGraphCardFonts("en", ["Launch 🚀 day", ""]);

    expect(texts).toEqual(["Launch  day", ""]);
  });
});
