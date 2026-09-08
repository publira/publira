/**
 * Brand hex values from `@publira/brand/theme.css` defaults.
 * Email clients do not load CSS variables, so the fallbacks are inlined here.
 */
export const emailColors = {
  background: "#f5f5f2",
  border: "#d6d6d0",
  brand: "#2b4c8c",
  buttonForeground: "#ffffff",
  card: "#ffffff",
  foreground: "#1f1d1a",
  muted: "#5f5e59",
} as const;

export const emailFonts = {
  sans: '"Hiragino Sans", "BIZ UDPGothic", "Yu Gothic", "Noto Sans CJK JP", "Noto Sans JP", system-ui, sans-serif',
  serif:
    '"Hiragino Mincho ProN", "BIZ UDPMincho", "Yu Mincho", "Noto Serif CJK JP", "Noto Serif JP", serif',
} as const;
