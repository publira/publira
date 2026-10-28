"use client";

import { useEffect } from "react";

import {
  applyThemePreference,
  parseThemePreference,
  THEME_PREFERENCE_STORAGE_KEY,
} from "#lib/theme-preference";
import { readWebStorage, subscribeToWebStorage } from "#lib/web-storage";

/**
 * Keeps `<html data-theme>` naming the reader's stored theme after the inline
 * script set it on load: a choice made on the switch, and one made in another
 * of the site's tabs, both reach the document through the stored value.
 */
export const DocumentTheme = () => {
  useEffect(() => {
    const apply = () => {
      applyThemePreference(
        parseThemePreference(
          readWebStorage("local", THEME_PREFERENCE_STORAGE_KEY)
        )
      );
    };

    apply();
    return subscribeToWebStorage("local", THEME_PREFERENCE_STORAGE_KEY, apply);
  }, []);

  return null;
};
