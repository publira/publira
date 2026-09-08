/**
 * Brand hex values from `@publira/brand/theme.css` defaults.
 * Email clients do not load CSS variables, so the fallbacks are inlined here.
 */
export const emailColors = {
  background: "#f6f2e9",
  border: "#d7ccba",
  brand: "#0f7c82",
  buttonForeground: "#f4fbfb",
  card: "#fffdf8",
  foreground: "#1e2b38",
  muted: "#5c6773",
} as const;

export const emailFonts = {
  sans: '"Hiragino Sans", "BIZ UDPGothic", "Yu Gothic", "Noto Sans CJK JP", "Noto Sans JP", system-ui, sans-serif',
  serif:
    '"Hiragino Mincho ProN", "BIZ UDPMincho", "Yu Mincho", "Noto Serif CJK JP", "Noto Serif JP", serif',
} as const;
