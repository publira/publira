/**
 * The dark palette `db/seeds/dev/110_tenant_theme_dark.sql` saves for the
 * development seed tenant, keyed by the name of the field the console's
 * Branding screen edits each color in.
 *
 * `task e2e:db` seeds it, so every suite starts from a storefront that offers
 * the header's Theme control. A suite that deletes the palette saves these back
 * to leave the seed tenant as it found it.
 */
export const SEED_DARK_THEME = {
  accent_color: "#1e2a42",
  accent_foreground_color: "#c3d2f0",
  background_color: "#171614",
  border_color: "#3a3934",
  card_color: "#23221f",
  card_foreground_color: "#ecebe6",
  destructive_color: "#e87a7a",
  destructive_foreground_color: "#2b0707",
  foreground_color: "#ecebe6",
  info_color: "#84acd8",
  info_foreground_color: "#0b1a2b",
  input_color: "#46453f",
  muted_color: "#2b2a26",
  muted_foreground_color: "#aaa8a1",
  popover_color: "#23221f",
  popover_foreground_color: "#ecebe6",
  primary_color: "#8ea9e0",
  primary_foreground_color: "#0f1d3a",
  ring_color: "#8ea9e0",
  secondary_color: "#ea7a52",
  secondary_foreground_color: "#220902",
  success_color: "#7cc796",
  success_foreground_color: "#0b2414",
  surface_color: "#1d1c19",
  surface_foreground_color: "#ecebe6",
  warning_color: "#e3b264",
  warning_foreground_color: "#2a1a02",
} as const;
