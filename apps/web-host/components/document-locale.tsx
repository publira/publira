"use client";

import type { Locale } from "@publira/i18n";
import { useEffect } from "react";

/**
 * Keeps `<html lang>` naming the locale the reader is being served.
 *
 * The attribute is not rendered: the root layout reads nothing, so it ships an
 * `<html>` with no `lang` at all and `PATH_LOCALE_LANG_SCRIPT` writes the
 * value while the document is still being parsed. That script runs once per
 * document, and every option in the header language control is a `next/link`,
 * so switching language is a client-side navigation: React re-renders the root
 * element the server described without `lang` and the attribute the script had
 * set goes missing until the reader happens to reload. A screen reader, a
 * translation tool, and a crawler all lose the one signal that says which
 * language the page is in.
 *
 * So the document element is an external system this component synchronizes
 * with, the same way the console control writes `document.documentElement.lang`
 * once its Server Action resolved. Effects run after the commit that dropped
 * the attribute, which is what makes this survive the navigation a handler on
 * the link would not: the handler fires before the transition.
 *
 * It renders nothing, and it belongs beside `<LocaleProvider>` — the layouts
 * that seed the locale for the client are exactly the places that know which
 * language the document is in.
 */
export const DocumentLocale = ({ locale }: { locale: Locale }) => {
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return null;
};
