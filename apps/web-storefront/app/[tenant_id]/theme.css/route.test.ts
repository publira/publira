import { findThemeTextContrastIssues } from "@publira/utils/theme-contrast";
import { DEFAULT_TENANT_THEME_COLORS } from "@publira/utils/theme-css-variables";
import type { TenantThemeColors } from "@publira/utils/theme-css-variables";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetTenantTheme } = vi.hoisted(() => ({
  mockGetTenantTheme: vi.fn(),
}));

vi.mock("#lib/tenant", () => ({
  getTenantTheme: mockGetTenantTheme,
}));

const { GET } = await import("./route");

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

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

/** `primaryForegroundColor` as `--publira-color-primary-foreground`. */
const toCssProperty = (key: string): string => {
  const kebab = key
    .replace(/Color$/u, "")
    .replaceAll(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
  return `--publira-color-${kebab}`;
};

const COLOR_KEY_BY_PROPERTY = new Map(
  Object.keys(DEFAULT_TENANT_THEME_COLORS).map((key) => [
    toCssProperty(key),
    key as keyof TenantThemeColors,
  ])
);

/**
 * The palette one rule block of the stylesheet sets, read back from its
 * declarations so a color written into the wrong token shows up as a pair
 * that no longer reads.
 */
const paletteIn = (block: string): TenantThemeColors => {
  const palette = { ...DEFAULT_TENANT_THEME_COLORS };
  for (const declaration of block.split(";")) {
    const [property = "", value = ""] = declaration.split(":");
    const key = COLOR_KEY_BY_PROPERTY.get(property);
    if (key) {
      palette[key] = value;
    }
  }
  return palette;
};

/** The declarations of every block whose selector is `selector`. */
const blocksFor = (css: string, selector: string): string[] =>
  css
    .split(`${selector}{`)
    .slice(1)
    .map((rest) => rest.slice(0, rest.indexOf("}")));

const requestThemeCss = async () => {
  const response = await GET(
    new NextRequest("https://shop.example.test/theme.css"),
    { params: Promise.resolve({ tenant_id: TENANT_ID }) }
  );
  return response.text();
};

describe("GET /theme.css", () => {
  beforeEach(() => {
    mockGetTenantTheme.mockReset();
  });

  it("returns dedicated theme values and short-term cache headers", async () => {
    mockGetTenantTheme.mockResolvedValueOnce({
      light: {
        primaryColor: "#112233",
        sansFontFamily: "Arial, sans-serif",
      },
    });

    const response = await GET(
      new NextRequest("https://shop.example.test/theme.css"),
      {
        params: Promise.resolve({
          tenant_id: "11111111-1111-4111-8111-111111111111",
        }),
      }
    );

    const css = await response.text();
    expect(css).toContain("--publira-color-primary:#112233;");
    expect(css).toContain("--publira-font-sans:Arial, sans-serif");
    expect(css).not.toContain("color-scheme:dark");
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=30, s-maxage=30, stale-while-revalidate=60"
    );
    expect(response.headers.get("Content-Type")).toBe(
      "text/css; charset=utf-8"
    );
    expect(mockGetTenantTheme).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111"
    );
  });

  it("Returns default theme for invalid tenant ID that does not pass through proxy", async () => {
    const response = await GET(
      new NextRequest("https://shop.example.test/theme.css"),
      { params: Promise.resolve({ tenant_id: "not-a-tenant" }) }
    );

    await expect(response.text()).resolves.toContain(
      "--publira-color-primary:#2b4c8c;"
    );
    expect(mockGetTenantTheme).not.toHaveBeenCalled();
  });

  it("writes no dark theme for a tenant without a dark palette", async () => {
    mockGetTenantTheme.mockResolvedValueOnce({
      light: DEFAULT_TENANT_THEME_COLORS,
    });

    const css = await requestThemeCss();

    expect(css).not.toContain("prefers-color-scheme");
    expect(css).not.toContain("data-theme");
  });

  it("writes the dark palette for the system setting and for a dark choice", async () => {
    mockGetTenantTheme.mockResolvedValueOnce({
      dark: DARK_PALETTE,
      light: DEFAULT_TENANT_THEME_COLORS,
    });

    const css = await requestThemeCss();
    const system = blocksFor(css, ':root:not([data-theme="light"])');
    const chosen = blocksFor(css, ':root[data-theme="dark"]');

    expect(css).toContain(
      '@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){'
    );
    expect(system).toHaveLength(1);
    expect(chosen).toHaveLength(1);
    expect(system[0]).toBe(chosen[0]);
    expect(chosen[0]).toContain("color-scheme:dark");
    expect(paletteIn(chosen[0] ?? "")).toEqual(DARK_PALETTE);
  });

  it("keeps every text pair readable in both palettes it writes", async () => {
    mockGetTenantTheme.mockResolvedValueOnce({
      dark: DARK_PALETTE,
      light: DEFAULT_TENANT_THEME_COLORS,
    });

    const css = await requestThemeCss();
    const [light = ""] = blocksFor(css, ":root");
    const [dark = ""] = blocksFor(css, ':root[data-theme="dark"]');

    expect(findThemeTextContrastIssues(paletteIn(light))).toEqual([]);
    expect(findThemeTextContrastIssues(paletteIn(dark))).toEqual([]);
  });
});
