"use client";

import { useEffect } from "react";

import { readCookieLocale } from "#lib/document-locale";

/**
 * Writes `<html lang>` back after the root layout remounts.
 *
 * The `<head>` script names the language once per document. Switching the
 * display language changes the `[locale]` root parameter, and React mounts the
 * root layout afresh for it, which clears the attributes of the `<html>` it
 * renders without a `lang`. Mounting again is what runs this, so it applies the
 * script's rule to the cookies as they now stand.
 */
export const DocumentLocale = () => {
  useEffect(() => {
    const locale = readCookieLocale();

    if (locale) {
      document.documentElement.lang = locale;
    }
  }, []);

  return null;
};
