/**
 * The theme a reader has chosen on the site. `system` follows the browser's
 * `prefers-color-scheme`, and is what a reader who has chosen nothing gets.
 */
export type ThemePreference = "dark" | "light" | "system";

/**
 * One key for every tenant: the inline script that applies it runs before
 * anything names the tenant, and light or dark is a choice about the reader's
 * own screen rather than a statement on one site.
 */
export const THEME_PREFERENCE_STORAGE_KEY = "publira.theme";

/** A stored value, or `system` for nothing stored and for anything else. */
export const parseThemePreference = (value: string | null): ThemePreference =>
  value === "dark" || value === "light" ? value : "system";

/**
 * Writes the preference onto `<html data-theme>`, the attribute `/theme.css`
 * keys the tenant's dark palette on. `system` removes it, which leaves the
 * stylesheet's `prefers-color-scheme` block in charge.
 */
export const applyThemePreference = (preference: ThemePreference): void => {
  const root = document.documentElement;
  if (preference === "system") {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = preference;
  }
};

/**
 * {@link applyThemePreference} for the stored value, inlined into `<head>` so
 * it runs while the document is still being parsed and the first paint is
 * already in the chosen theme. It sets the attribute whether or not the tenant
 * has a dark palette: without one, `/theme.css` has no rule the attribute
 * matches, and it changes nothing.
 */
export const THEME_PREFERENCE_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_PREFERENCE_STORAGE_KEY)});if(t==="dark"||t==="light"){document.documentElement.dataset.theme=t}}catch(e){}})()`;
