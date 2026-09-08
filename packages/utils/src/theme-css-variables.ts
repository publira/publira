/**
 * Maps TenantTheme color fields to `--publira-color-*` CSS custom properties
 * consumed by `@publira/brand/theme.css`.
 */

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

const isHexColor = (value: string): boolean => HEX_COLOR.test(value);

/**
 * Normalize partial theme input with brand defaults.
 * Invalid / empty color values fall back to defaults.
 */
export const resolveTenantThemeColors = (
  theme?: Partial<TenantThemeColors> | null
): TenantThemeColors => {
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
  return resolved;
};

/**
 * Build a style map of `--publira-color-*` custom properties for React
 * `style` props or client-side `setProperty`.
 */
export const toPubliraThemeCssVariables = (
  theme?: Partial<TenantThemeColors> | null
): Record<string, string> => {
  const resolved = resolveTenantThemeColors(theme);
  const vars: Record<string, string> = {};
  for (const key of Object.keys(
    themeColorToCssVar
  ) as (keyof TenantThemeColors)[]) {
    vars[themeColorToCssVar[key]] = resolved[key];
  }
  return vars;
};

/**
 * Build a `:root { ... }` CSS text block for `GET /theme.css` responses.
 */
export const toPubliraThemeCssText = (
  theme?: Partial<TenantThemeColors> | null
): string => {
  const vars = toPubliraThemeCssVariables(theme);
  const declarations = Object.entries(vars)
    .map(([property, value]) => `${property}:${value}`)
    .join(";");
  return `:root{${declarations}}`;
};
