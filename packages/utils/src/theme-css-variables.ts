/**
 * Maps TenantTheme color fields to `--publira-color-*` CSS custom properties
 * consumed by `@publira/brand/theme.css`.
 */

import { z } from "zod";

export interface TenantThemeColors {
  accentColor: string;
  accentForegroundColor: string;
  backgroundColor: string;
  borderColor: string;
  cardColor: string;
  cardForegroundColor: string;
  destructiveColor: string;
  destructiveForegroundColor: string;
  foregroundColor: string;
  infoColor: string;
  infoForegroundColor: string;
  inputColor: string;
  mutedColor: string;
  mutedForegroundColor: string;
  popoverColor: string;
  popoverForegroundColor: string;
  primaryColor: string;
  primaryForegroundColor: string;
  ringColor: string;
  secondaryColor: string;
  secondaryForegroundColor: string;
  successColor: string;
  successForegroundColor: string;
  surfaceColor: string;
  surfaceForegroundColor: string;
  warningColor: string;
  warningForegroundColor: string;
}

export interface TenantThemeFontFamilies {
  serifFontFamily: string;
  sansFontFamily: string;
}

export type TenantTheme = TenantThemeColors & TenantThemeFontFamilies;

/** Default stacks (keep in sync with packages/brand/theme.css). */
export const DEFAULT_TENANT_THEME_FONT_FAMILIES = {
  sansFontFamily:
    '"Hiragino Sans", "BIZ UDPGothic", "Yu Gothic", "Noto Sans CJK JP", "Noto Sans JP", system-ui, sans-serif',
  serifFontFamily:
    '"Hiragino Mincho ProN", "BIZ UDPMincho", "Yu Mincho", "Noto Serif CJK JP", "Noto Serif JP", serif',
} as const;

/** Default brand colors (keep in sync with packages/brand/theme.css). */
export const DEFAULT_TENANT_THEME_COLORS: TenantThemeColors = {
  accentColor: "#e3e9f5",
  accentForegroundColor: "#22407a",
  backgroundColor: "#f5f5f2",
  borderColor: "#d6d6d0",
  cardColor: "#ffffff",
  cardForegroundColor: "#1f1d1a",
  destructiveColor: "#8f1d1d",
  destructiveForegroundColor: "#ffffff",
  foregroundColor: "#1f1d1a",
  infoColor: "#2f5d8a",
  infoForegroundColor: "#ffffff",
  inputColor: "#cfcfc8",
  mutedColor: "#e8e8e3",
  mutedForegroundColor: "#5f5e59",
  popoverColor: "#ffffff",
  popoverForegroundColor: "#1f1d1a",
  primaryColor: "#2b4c8c",
  primaryForegroundColor: "#ffffff",
  ringColor: "#2b4c8c",
  secondaryColor: "#c63d17",
  secondaryForegroundColor: "#ffffff",
  successColor: "#2a6b3f",
  successForegroundColor: "#ffffff",
  surfaceColor: "#fafaf8",
  surfaceForegroundColor: "#1f1d1a",
  warningColor: "#8a5a0b",
  warningForegroundColor: "#ffffff",
};

/** The stored form of the default theme: empty stacks select the brand defaults. */
export const DEFAULT_TENANT_THEME: TenantTheme = {
  ...DEFAULT_TENANT_THEME_COLORS,
  sansFontFamily: "",
  serifFontFamily: "",
};

const themeColorToCssVar: {
  [K in keyof TenantThemeColors]: `--publira-color-${string}`;
} = {
  accentColor: "--publira-color-accent",
  accentForegroundColor: "--publira-color-accent-foreground",
  backgroundColor: "--publira-color-background",
  borderColor: "--publira-color-border",
  cardColor: "--publira-color-card",
  cardForegroundColor: "--publira-color-card-foreground",
  destructiveColor: "--publira-color-destructive",
  destructiveForegroundColor: "--publira-color-destructive-foreground",
  foregroundColor: "--publira-color-foreground",
  infoColor: "--publira-color-info",
  infoForegroundColor: "--publira-color-info-foreground",
  inputColor: "--publira-color-input",
  mutedColor: "--publira-color-muted",
  mutedForegroundColor: "--publira-color-muted-foreground",
  popoverColor: "--publira-color-popover",
  popoverForegroundColor: "--publira-color-popover-foreground",
  primaryColor: "--publira-color-primary",
  primaryForegroundColor: "--publira-color-primary-foreground",
  ringColor: "--publira-color-ring",
  secondaryColor: "--publira-color-secondary",
  secondaryForegroundColor: "--publira-color-secondary-foreground",
  successColor: "--publira-color-success",
  successForegroundColor: "--publira-color-success-foreground",
  surfaceColor: "--publira-color-surface",
  surfaceForegroundColor: "--publira-color-surface-foreground",
  warningColor: "--publira-color-warning",
  warningForegroundColor: "--publira-color-warning-foreground",
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/u;
const MAXIMUM_FONT_FAMILY_LENGTH = 512;
const FORBIDDEN_FONT_FAMILY_CHARACTER = /[;{}()\\/<>@\p{Cc}]/u;
const UNQUOTED_FONT_FAMILY = /^[\p{L}_-][\p{L}\p{N}_\-\p{Zs}]*$/u;

const isHexColor = (value: string): boolean => HEX_COLOR.test(value);

/**
 * Whether a value can be written into a `font-family` declaration verbatim.
 * This intentionally accepts a smaller grammar than CSS: no escapes or
 * functions means a tenant-controlled value cannot introduce CSS syntax.
 */
export const isTenantThemeFontFamily = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }
  if (
    new TextEncoder().encode(trimmed).byteLength > MAXIMUM_FONT_FAMILY_LENGTH ||
    FORBIDDEN_FONT_FAMILY_CHARACTER.test(trimmed)
  ) {
    return false;
  }

  const families: string[] = [];
  let family = "";
  let quote = "";
  for (const character of trimmed) {
    if (character === "'" || character === '"') {
      quote = quote === character ? "" : quote || character;
    }
    if (character === "," && !quote) {
      families.push(family.trim());
      family = "";
      continue;
    }
    family += character;
  }
  if (quote) {
    return false;
  }
  families.push(family.trim());

  return families.every((name) => {
    if (!name) {
      return false;
    }
    const [first] = name;
    if (first === "'" || first === '"') {
      return (
        name.length >= 3 &&
        name.at(-1) === first &&
        name.slice(1, -1).trim().length > 0
      );
    }
    return UNQUOTED_FONT_FAMILY.test(name);
  });
};

/** A Zod boundary schema shared by theme settings forms. */
export const tenantThemeFontFamilySchema = (errorMessage: string) =>
  z.string().trim().refine(isTenantThemeFontFamily, { error: errorMessage });

/**
 * Normalize partial theme input with brand defaults.
 * Invalid / empty color values fall back to defaults.
 */
export const resolveTenantThemeColors = (
  theme?: Partial<TenantTheme> | null
): TenantTheme => {
  const source = theme ?? {};
  const resolved = { ...DEFAULT_TENANT_THEME_COLORS };
  for (const key of Object.keys(
    DEFAULT_TENANT_THEME_COLORS
  ) as (keyof TenantThemeColors)[]) {
    const raw = source[key]?.trim() ?? "";
    if (isHexColor(raw)) {
      resolved[key] = raw.toLowerCase();
    }
  }
  return {
    ...resolved,
    sansFontFamily: isTenantThemeFontFamily(source.sansFontFamily ?? "")
      ? (source.sansFontFamily?.trim() ?? "")
      : "",
    serifFontFamily: isTenantThemeFontFamily(source.serifFontFamily ?? "")
      ? (source.serifFontFamily?.trim() ?? "")
      : "",
  };
};

/**
 * Build a style map of `--publira-color-*` custom properties for React
 * `style` props or client-side `setProperty`.
 */
export const toPubliraThemeCssVariables = (
  theme?: Partial<TenantTheme> | null
): Record<string, string> => {
  const resolved = resolveTenantThemeColors(theme);
  const vars: Record<string, string> = {};
  for (const key of Object.keys(
    themeColorToCssVar
  ) as (keyof TenantThemeColors)[]) {
    vars[themeColorToCssVar[key]] = resolved[key];
  }
  if (resolved.serifFontFamily) {
    vars["--publira-font-serif"] = resolved.serifFontFamily;
  }
  if (resolved.sansFontFamily) {
    vars["--publira-font-sans"] = resolved.sansFontFamily;
  }
  return vars;
};

/**
 * Build a `:root { ... }` CSS text block for `GET /theme.css` responses.
 */
export const toPubliraThemeCssText = (
  theme?: Partial<TenantTheme> | null
): string => {
  const vars = toPubliraThemeCssVariables(theme);
  const declarations = Object.entries(vars)
    .map(([property, value]) => `${property}:${value}`)
    .join(";");
  return `:root{${declarations}}`;
};
