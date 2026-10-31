import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_TENANT_THEME,
  DEFAULT_TENANT_THEME_COLORS,
  isTenantThemeFontFamily,
  resolveTenantThemeColors,
  resolveTenantThemePalette,
  toPubliraThemeCssText,
  toPubliraThemeCssVariables,
} from "./theme-css-variables";
import type { TenantThemeColors } from "./theme-css-variables";

/** A dark palette whose every text pair clears 4.5:1. */
const DARK_PALETTE: TenantThemeColors = {
  accentColor: "#22314f",
  accentForegroundColor: "#d3def5",
  backgroundColor: "#1a1917",
  borderColor: "#3d3a35",
  cardColor: "#262420",
  cardForegroundColor: "#ecebe6",
  destructiveColor: "#f08a8a",
  destructiveForegroundColor: "#3a0b0b",
  foregroundColor: "#ecebe6",
  infoColor: "#8ab8e0",
  infoForegroundColor: "#0d2236",
  inputColor: "#4a4740",
  mutedColor: "#2e2c28",
  mutedForegroundColor: "#b3b1aa",
  popoverColor: "#2b2925",
  popoverForegroundColor: "#ecebe6",
  primaryColor: "#8eb1f2",
  primaryForegroundColor: "#14213d",
  ringColor: "#8eb1f2",
  secondaryColor: "#f08a63",
  secondaryForegroundColor: "#2a1007",
  successColor: "#7fc896",
  successForegroundColor: "#0f2a18",
  surfaceColor: "#211f1c",
  surfaceForegroundColor: "#ecebe6",
  warningColor: "#e6b45c",
  warningForegroundColor: "#2b1d04",
};

describe("theme-css-variables", () => {
  it("falls back to brand defaults for empty input", () => {
    expect(resolveTenantThemeColors(null)).toEqual(DEFAULT_TENANT_THEME);
    expect(resolveTenantThemeColors({})).toEqual(DEFAULT_TENANT_THEME);
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

  it("reads a dark palette only when every color is a #RRGGBB code", () => {
    const palette = { ...DARK_PALETTE, primaryColor: "#8EB1F2" };

    expect(resolveTenantThemePalette(palette)).toEqual({
      ...DARK_PALETTE,
      primaryColor: "#8eb1f2",
    });
    expect(
      resolveTenantThemePalette({ ...DARK_PALETTE, mutedColor: "" })
    ).toBeUndefined();
    expect(
      resolveTenantThemePalette({ ...DARK_PALETTE, ringColor: "blue" })
    ).toBeUndefined();
    expect(resolveTenantThemePalette(undefined)).toBeUndefined();
  });

  it("writes the light palette alone when there is no dark palette", () => {
    const css = toPubliraThemeCssText({ primaryColor: "#112233" });

    expect(css).not.toContain("@media");
    expect(css).not.toContain("data-theme");
    expect(css).not.toContain("color-scheme");
  });

  it("writes a dark palette for the system setting and for a dark choice", () => {
    const css = toPubliraThemeCssText(
      { primaryColor: "#112233" },
      DARK_PALETTE
    );

    const dark = `color-scheme:dark;--publira-color-accent:${DARK_PALETTE.accentColor};`;

    expect(css.startsWith(":root{--publira-color-accent:")).toBe(true);
    expect(css).toContain(
      `@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${dark}`
    );
    expect(css).toContain(`:root[data-theme="dark"]{${dark}`);
    expect(css).toContain(
      `--publira-color-background:${DARK_PALETTE.backgroundColor}`
    );
    expect(css.match(/--publira-font-/gu)).toBeNull();
  });

  it("emits configured font stacks without overriding defaults for empty values", () => {
    const vars = toPubliraThemeCssVariables({
      serifFontFamily: '"Noto Serif KR", serif',
    });

    expect(vars["--publira-font-serif"]).toBe('"Noto Serif KR", serif');
    expect(vars["--publira-font-sans"]).toBeUndefined();
  });

  it("only accepts a safe CSS font-family list", () => {
    expect(
      isTenantThemeFontFamily('"Noto Sans SC", PingFang SC, sans-serif')
    ).toBe(true);

    for (const value of [
      "Noto Sans; color:red",
      "Noto Sans { color: red }",
      "url(font)",
      "Noto Sans/serif",
      '"unclosed',
      "Noto Sans,, sans-serif",
      "Noto Sans\\, serif",
      "Noto Sans\nserif",
    ]) {
      expect(isTenantThemeFontFamily(value)).toBe(false);
    }
  });
});

describe("the fallbacks in @publira/brand's theme.css", () => {
  // That package is a stylesheet with no build or test of its own, so the
  // agreement between its `var()` fallbacks and the defaults declared here is
  // asserted from this side. The path is relative because nothing in this
  // package imports that CSS at runtime.
  const themeCss = readFileSync(
    new URL("../../brand/theme.css", import.meta.url),
    "utf-8"
  );

  it("name the same colors as DEFAULT_TENANT_THEME_COLORS", () => {
    const pattern =
      /var\(\s*(?<token>--publira-color-[a-z-]+)\s*,\s*(?<color>#[0-9a-f]{6})\s*\)/gu;

    const fallbacks = Object.fromEntries(
      [...themeCss.matchAll(pattern)].map((match) => [
        match.groups?.token,
        match.groups?.color,
      ])
    );

    expect(fallbacks).toEqual(
      toPubliraThemeCssVariables(DEFAULT_TENANT_THEME_COLORS)
    );
  });
});
