import type { TenantThemeColors } from "./theme-css-variables";

/** WCAG AA minimum contrast ratio for normal-size text. */
export const THEME_TEXT_CONTRAST_MIN_RATIO = 4.5;

export interface ThemeContrastPair {
  background: keyof TenantThemeColors;
  foreground: keyof TenantThemeColors;
}

/**
 * Every theme token pair where the foreground is rendered as text over the
 * background. Keeping this list shared makes the settings form validate the
 * same UI pairs it previews.
 */
export const THEME_TEXT_CONTRAST_PAIRS: readonly ThemeContrastPair[] = [
  { background: "primaryColor", foreground: "primaryForegroundColor" },
  { background: "secondaryColor", foreground: "secondaryForegroundColor" },
  { background: "accentColor", foreground: "accentForegroundColor" },
  { background: "backgroundColor", foreground: "foregroundColor" },
  { background: "surfaceColor", foreground: "surfaceForegroundColor" },
  { background: "cardColor", foreground: "cardForegroundColor" },
  { background: "popoverColor", foreground: "popoverForegroundColor" },
  { background: "mutedColor", foreground: "mutedForegroundColor" },
  { background: "successColor", foreground: "successForegroundColor" },
  { background: "warningColor", foreground: "warningForegroundColor" },
  {
    background: "destructiveColor",
    foreground: "destructiveForegroundColor",
  },
  { background: "infoColor", foreground: "infoForegroundColor" },
];

export interface ThemeContrastIssue extends ThemeContrastPair {
  ratio: number;
}

const parseHexColor = (color: string): readonly [number, number, number] => [
  Number.parseInt(color.slice(1, 3), 16),
  Number.parseInt(color.slice(3, 5), 16),
  Number.parseInt(color.slice(5, 7), 16),
];

const linearizeColorComponent = (component: number): number => {
  const normalized = component / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
};

const relativeLuminance = (color: string): number => {
  const [red, green, blue] = parseHexColor(color);

  return (
    0.2126 * linearizeColorComponent(red) +
    0.7152 * linearizeColorComponent(green) +
    0.0722 * linearizeColorComponent(blue)
  );
};

/** Returns the WCAG contrast ratio for two validated #RRGGBB colors. */
export const colorContrastRatio = (
  firstColor: string,
  secondColor: string
): number => {
  const first = relativeLuminance(firstColor);
  const second = relativeLuminance(secondColor);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
};

/** Finds text colors that cannot be read reliably against their background. */
export const findThemeTextContrastIssues = (
  theme: TenantThemeColors
): ThemeContrastIssue[] =>
  THEME_TEXT_CONTRAST_PAIRS.flatMap((pair) => {
    const ratio = colorContrastRatio(
      theme[pair.background],
      theme[pair.foreground]
    );
    return ratio >= THEME_TEXT_CONTRAST_MIN_RATIO ? [] : [{ ...pair, ratio }];
  });
