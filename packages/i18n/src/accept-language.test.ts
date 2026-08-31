import { describe, expect, it } from "vitest";

import localeIndex from "../../../locales/index.json" with { type: "json" };
import { negotiateInitialLocale } from "./accept-language";

const missing: unknown = undefined;

describe("negotiateInitialLocale", () => {
  it("returns a supported locale the header names outright", () => {
    expect(negotiateInitialLocale("ja")).toBe("ja");
    expect(negotiateInitialLocale("en")).toBe("en");
  });

  it("matches a subtagged range against its base language", () => {
    expect(negotiateInitialLocale("ja-JP")).toBe("ja");
    expect(negotiateInitialLocale("en-US")).toBe("en");
    expect(negotiateInitialLocale("en-GB")).toBe("en");
    expect(negotiateInitialLocale("zh-Hant-TW,ja-JP")).toBe("ja");
  });

  it("ignores the case of a language tag", () => {
    expect(negotiateInitialLocale("JA")).toBe("ja");
    expect(negotiateInitialLocale("EN-us")).toBe("en");
    expect(negotiateInitialLocale("Ja-Jp")).toBe("ja");
  });

  it("takes the highest qvalue rather than the first range", () => {
    expect(negotiateInitialLocale("en;q=0.7, ja;q=0.9")).toBe("ja");
    expect(negotiateInitialLocale("ja;q=0.2, en;q=0.8")).toBe("en");
    // An omitted weight is q=1, so it outranks an explicit 0.9.
    expect(negotiateInitialLocale("ja;q=0.9, en")).toBe("en");
    expect(negotiateInitialLocale("fr, en;q=0.9, ja;q=1")).toBe("ja");
  });

  it("keeps header order between ranges of equal weight", () => {
    expect(negotiateInitialLocale("en, ja")).toBe("en");
    expect(negotiateInitialLocale("ja, en")).toBe("ja");
    expect(negotiateInitialLocale("en;q=0.5, ja;q=0.5")).toBe("en");
  });

  it("never chooses a range rejected with q=0", () => {
    // Without the rejection each of these would win: it is the only range,
    // or it outranks the one that does get chosen.
    expect(negotiateInitialLocale("ja;q=0")).toBe("en");
    expect(negotiateInitialLocale("en;q=0, ja;q=0.1")).toBe("ja");
    expect(negotiateInitialLocale("en;q=0.000, ja;q=0.1")).toBe("ja");
  });

  it("tolerates whitespace around ranges and weights", () => {
    expect(negotiateInitialLocale("  ja  ")).toBe("ja");
    expect(negotiateInitialLocale(" en ; q=0.4 , ja ; q=0.8 ")).toBe("ja");
  });

  it("falls back to en for a header with no supported locale", () => {
    expect(negotiateInitialLocale("fr")).toBe("en");
    expect(negotiateInitialLocale("fr-FR, de-DE;q=0.8, ko;q=0.5")).toBe("en");
  });

  it("falls back to en when the header is absent or empty", () => {
    expect(negotiateInitialLocale(null)).toBe("en");
    expect(negotiateInitialLocale(missing as string | undefined)).toBe("en");
    expect(negotiateInitialLocale("")).toBe("en");
    expect(negotiateInitialLocale("   ")).toBe("en");
    expect(negotiateInitialLocale(",,")).toBe("en");
  });

  it("drops a malformed element without discarding the rest", () => {
    expect(negotiateInitialLocale("ja;q=abc, en")).toBe("en");
    expect(negotiateInitialLocale("en;q=2, ja")).toBe("ja");
    expect(negotiateInitialLocale("en;q=0.5000, ja;q=0.1")).toBe("ja");
    expect(negotiateInitialLocale("en;q=0.9;x=1, ja;q=0.1")).toBe("ja");
    expect(negotiateInitialLocale("日本語, ja")).toBe("ja");
    expect(negotiateInitialLocale("en_US, ja")).toBe("ja");
    expect(negotiateInitialLocale("toolongprimary-tag, en")).toBe("en");
  });

  it("falls back to en when every element is malformed", () => {
    expect(negotiateInitialLocale("ja;q=abc")).toBe("en");
    expect(negotiateInitialLocale(";;;")).toBe("en");
  });

  it("ignores the wildcard instead of matching an arbitrary locale", () => {
    expect(negotiateInitialLocale("*")).toBe("en");
    expect(negotiateInitialLocale("fr, *")).toBe("en");
    expect(negotiateInitialLocale("*;q=1, ja;q=0.5")).toBe("ja");
  });

  it("only ever returns a locale from the locale index", () => {
    const supported: readonly string[] = localeIndex.locales.map(
      ({ code }) => code
    );

    const headers = [
      "ja",
      "en-US,en;q=0.9",
      "fr-FR,fr;q=0.9,de;q=0.8",
      "*",
      "",
      "ja;q=0",
      "not a header",
    ];
    for (const header of headers) {
      expect(supported).toContain(negotiateInitialLocale(header));
    }
  });
});
