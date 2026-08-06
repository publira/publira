import { describe, expect, it } from "vitest";

import {
  DEFAULT_TENANT_THEME_COLORS,
  resolveTenantThemeColors,
  toPubliraThemeCssText,
  toPubliraThemeCssVariables,
} from "./theme-css-variables";

describe("theme-css-variables", () => {
  it("falls back to brand defaults for empty input", () => {
    expect(resolveTenantThemeColors(null)).toEqual(DEFAULT_TENANT_THEME_COLORS);
    expect(resolveTenantThemeColors({})).toEqual(DEFAULT_TENANT_THEME_COLORS);
  });

  it("merges partial theme and lowercases valid hex colors", () => {
    const resolved = resolveTenantThemeColors({
      primaryColor: "#AABBCC",
      secondaryColor: "not-a-color",
    });

    expect(resolved.primaryColor).toBe("#aabbcc");
    expect(resolved.secondaryColor).toBe(
      DEFAULT_TENANT_THEME_COLORS.secondaryColor
    );
    expect(resolved.accentColor).toBe(DEFAULT_TENANT_THEME_COLORS.accentColor);
  });

  it("maps theme colors to --publira-color-* CSS variables", () => {
    const vars = toPubliraThemeCssVariables({
      backgroundColor: "#445566",
      primaryColor: "#112233",
    });

    expect(vars["--publira-color-primary"]).toBe("#112233");
    expect(vars["--publira-color-background"]).toBe("#445566");
    expect(vars["--publira-color-foreground"]).toBe(
      DEFAULT_TENANT_THEME_COLORS.foregroundColor
    );
    expect(
      Object.keys(vars).every((key) => key.startsWith("--publira-color-"))
    ).toBe(true);
    expect(Object.keys(vars)).toHaveLength(
      Object.keys(DEFAULT_TENANT_THEME_COLORS).length
    );
  });

  it("builds a :root CSS text block for style-tag injection", () => {
    const css = toPubliraThemeCssText({ primaryColor: "#112233" });
    expect(css.startsWith(":root{")).toBe(true);
    expect(css.endsWith("}")).toBe(true);
    expect(css).toContain("--publira-color-primary:#112233");
    expect(css).toContain(
      `--publira-color-background:${DEFAULT_TENANT_THEME_COLORS.backgroundColor}`
    );
  });
});
