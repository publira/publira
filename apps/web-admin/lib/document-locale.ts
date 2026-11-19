/**
 * The locale the browser alone can name, from the two cookies the console's
 * responses carry: `publira_locale`, the operator's own choice, then
 * `publira_resolved_locale`, the tenant's stored default `proxy.ts` publishes.
 * It is the order `LOCALE_LANG_SCRIPT` in `@publira/i18n` applies them in, and
 * `undefined` for a browser that holds neither.
 */

import {
  LOCALE_COOKIE_NAME,
  parseLocaleCookie,
  RESOLVED_LOCALE_COOKIE_NAME,
} from "@publira/i18n";
import type { Locale } from "@publira/i18n";

const readCookie = (name: string): string => {
  if (typeof document === "undefined") {
    return "";
  }

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

export const readCookieLocale = (): Locale | undefined =>
  parseLocaleCookie(readCookie(LOCALE_COOKIE_NAME)) ??
  parseLocaleCookie(readCookie(RESOLVED_LOCALE_COOKIE_NAME));
