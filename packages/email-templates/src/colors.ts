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
  sans: '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Segoe UI", sans-serif',
  serif: '"Yu Mincho", "Hiragino Mincho ProN", "Noto Serif JP", Georgia, serif',
} as const;
