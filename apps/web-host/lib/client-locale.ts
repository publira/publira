/**
 * The locale a chunk renders in when it has no provider above it.
 *
 * Only one thing is in that position: `app/[tenant_id]/[locale]/error.tsx`,
 * the boundary for the `(site)` and `(auth)` layouts. Those layouts are what
 * seed `<LocaleProvider>`, so a failure in them is precisely a render with no
 * context to read — and the same failure means the tenant read behind the
 * context is the one that just went wrong.
 *
 * Everything here is what the browser already holds, in the order the server
 * resolves from. The path names the locale on every URL but the one that
 * serves the tenant's default, and there `publira_resolved_locale` — the copy
 * `proxy.ts` publishes of the default it resolved to route the request — names
 * it instead. Both are the same values `PATH_LOCALE_LANG_SCRIPT` writes into
 * `<html lang>`, so the copy on screen and the attribute agree.
 *
 * A browser that carries neither falls through to what it asked for. That is a
 * statement about the visitor rather than a stand-in for the tenant's setting,
 * made where there is no stored answer within reach to state instead.
 */

import {
  negotiateInitialLocale,
  parseLocaleCookie,
  RESOLVED_LOCALE_COOKIE_NAME,
} from "@publira/i18n";
import type { Locale } from "@publira/i18n";

import { splitLocalePathname } from "./locale-path";

const readCookie = (name: string): string => {
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${name}=([^;]*)`, "u")
  );
  if (!match?.[1]) {
    return "";
  }

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
};

export const readClientLocale = (): Locale => {
  if (typeof document === "undefined") {
    return negotiateInitialLocale(null);
  }

  return (
    splitLocalePathname(window.location.pathname).locale ??
    parseLocaleCookie(readCookie(RESOLVED_LOCALE_COOKIE_NAME)) ??
    negotiateInitialLocale(navigator.languages.join(","))
  );
};
