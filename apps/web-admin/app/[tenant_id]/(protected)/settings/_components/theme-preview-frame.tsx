"use client";

import { toPubliraThemeCssVariables } from "@publira/utils/theme-css-variables";
import type { TenantTheme } from "@publira/utils/theme-css-variables";
import { createContext, use } from "react";
import type { CSSProperties, ReactNode } from "react";

/** The colors currently in `ThemeSettingsForm`, saved or not. */
export const ThemePreviewThemeContext = createContext<TenantTheme | null>(null);

/**
 * The frame `ThemePreview` is painted in, from the theme the form holds.
 *
 * The frame carries the theme itself rather than reading the console's own
 * tokens: `/theme.css` is a separate request with its own short cache, so
 * right after another operator saves, the document can still be painted in the
 * previous colors while the form already holds the current ones. Only what the
 * form says is on screen here.
 *
 * Nothing inside is interactive or reaches the accessibility tree — it is
 * sample content standing in for a site, and a screen reader announcing a
 * catalog that does not exist would be reading a lie.
 */
export const ThemePreviewFrame = ({ children }: { children: ReactNode }) => {
  const theme = use(ThemePreviewThemeContext);
  if (theme === null) {
    throw new Error("ThemeSettingsForm is required.");
  }

  // `CSSProperties` has no index signature, which is what React's own types
  // say to assert past when the value is a set of custom properties.
  const themeVariables = toPubliraThemeCssVariables(theme) as CSSProperties;

  return (
    <div
      aria-hidden="true"
      className="publira-theme-scope pointer-events-none overflow-hidden rounded-surface border border-border bg-background text-foreground"
      style={themeVariables}
    >
      {children}
    </div>
  );
};
