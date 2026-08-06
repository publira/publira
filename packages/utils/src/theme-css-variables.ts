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
  accentColor: "#7aae90",
  accentForegroundColor: "#0f2a1f",
  backgroundColor: "#f6f2e9",
  borderColor: "#d7ccba",
  cardColor: "#fffdf8",
  cardForegroundColor: "#1e2b38",
  destructiveColor: "#b54444",
  destructiveForegroundColor: "#fff4f4",
  foregroundColor: "#1e2b38",
  infoColor: "#3c78c2",
  infoForegroundColor: "#f3f8ff",
  inputColor: "#e3d8c7",
  mutedColor: "#e9e1d3",
  mutedForegroundColor: "#5c6773",
  popoverColor: "#fffdf8",
  popoverForegroundColor: "#1e2b38",
  primaryColor: "#0f7c82",
  primaryForegroundColor: "#f4fbfb",
  ringColor: "#2d8d93",
  secondaryColor: "#d96f4a",
  secondaryForegroundColor: "#fff6f1",
  successColor: "#2f8f5b",
  successForegroundColor: "#f3fcf7",
  surfaceColor: "#fbf8f2",
  surfaceForegroundColor: "#1e2b38",
  warningColor: "#c4872a",
  warningForegroundColor: "#fff8ea",
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
