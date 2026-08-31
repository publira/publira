import { describe, expect, it } from "vitest";

import {
  colorContrastRatio,
  findThemeTextContrastIssues,
  THEME_TEXT_CONTRAST_MIN_RATIO,
} from "./theme-contrast";
import { DEFAULT_TENANT_THEME_COLORS } from "./theme-css-variables";

describe("theme-contrast", () => {
  it("calculates the WCAG contrast ratio", () => {
    expect(colorContrastRatio("#000000", "#ffffff")).toBe(21);
    expect(colorContrastRatio("#ffffff", "#ffffff")).toBe(1);
  });

  it("accepts the default tenant theme", () => {
    expect(findThemeTextContrastIssues(DEFAULT_TENANT_THEME_COLORS)).toEqual(
      []
    );
  });

  it("identifies both tokens in an unreadable pair", () => {
    const issues = findThemeTextContrastIssues({
      ...DEFAULT_TENANT_THEME_COLORS,
      primaryForegroundColor: "#0f7c82",
    });

    expect(issues).toEqual([
      {
        background: "primaryColor",
        foreground: "primaryForegroundColor",
        ratio: 1,
      },
    ]);
    expect(THEME_TEXT_CONTRAST_MIN_RATIO).toBe(4.5);
  });
});
