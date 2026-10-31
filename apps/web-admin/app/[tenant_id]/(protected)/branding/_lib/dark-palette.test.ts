import {
  colorContrastRatio,
  findThemeTextContrastIssues,
} from "@publira/utils/theme-contrast";
import { DEFAULT_TENANT_THEME_COLORS } from "@publira/utils/theme-css-variables";
import { describe, expect, it } from "vitest";

import { deriveDarkPalette } from "./dark-palette";

const HEX_COLOR = /^#[0-9a-f]{6}$/u;

describe("deriveDarkPalette", () => {
  it("turns the paper dark and the ink light", () => {
    const dark = deriveDarkPalette(DEFAULT_TENANT_THEME_COLORS);

    expect(dark.backgroundColor).toBe("#0d0d0a");
    expect(dark.foregroundColor).toBe("#e5e3e0");
  });

  it("keeps the hue of a color while it inverts its lightness", () => {
    const dark = deriveDarkPalette({
      ...DEFAULT_TENANT_THEME_COLORS,
      accentColor: "#e3e9f5",
    });

    // A pale blue tint becomes a deep blue shade, not a gray or another hue.
    expect(dark.accentColor).toBe("#0a101c");
  });

  it("gives a palette every contrast pair of which the save accepts", () => {
    const dark = deriveDarkPalette(DEFAULT_TENANT_THEME_COLORS);

    expect(findThemeTextContrastIssues(dark)).toEqual([]);

    for (const color of Object.values(dark)) {
      expect(color).toMatch(HEX_COLOR);
    }
  });

  it("gives a pair the inversion leaves unreadable white or black text", () => {
    // Mid gray inverts to itself, so text and background stay one color.
    const dark = deriveDarkPalette({
      ...DEFAULT_TENANT_THEME_COLORS,
      primaryColor: "#808080",
      primaryForegroundColor: "#808080",
    });

    expect(dark.primaryForegroundColor).toBe("#000000");
    expect(
      colorContrastRatio(dark.primaryColor, dark.primaryForegroundColor)
    ).toBeGreaterThanOrEqual(4.5);
  });
});
