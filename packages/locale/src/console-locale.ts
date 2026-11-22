import { LOCALE_COOKIE_NAME, parseLocaleCookie } from "@publira/i18n";
import type { Locale } from "@publira/i18n";

/** A request that can carry the locale cookie. `proxy.ts` passes `NextRequest`. */
export interface LocaleCookieSource {
  cookies: {
    get: (name: string) => { value: string } | undefined;
  };
}

/**
 * The locale a console page request is rendered in: a supported
 * `publira_locale` cookie, then `storedDefault`.
 *
 * `storedDefault` is the app's to resolve. A `Locale` comes back as a
 * `Locale`. `null` comes back as `null` when the cookie names nothing either,
 * which is the page a console answers `503` for.
 */
export function consoleRequestLocale(
  request: LocaleCookieSource,
  storedDefault: Locale
): Locale;
export function consoleRequestLocale(
  request: LocaleCookieSource,
  storedDefault: Locale | null
): Locale | null;
export function consoleRequestLocale(
  request: LocaleCookieSource,
  storedDefault: Locale | null
): Locale | null {
  return (
    parseLocaleCookie(request.cookies.get(LOCALE_COOKIE_NAME)?.value) ??
    storedDefault
  );
}

/**
 * The pathname a console proxy rewrites a page onto.
 *
 * `prefix` is the tenant id in `web-admin` (`/{tenantId}/{locale}{path}`).
 * `web-platform` passes none (`/{locale}{path}`). A path of `/` adds no extra
 * segment. The caller still builds the `NextResponse`.
 */
export const consoleLocalePathname = (
  pathname: string,
  locale: string,
  prefix?: string
): string => {
  const rest = pathname === "/" ? "" : pathname;
  const localized = `/${locale}${rest}`;

  return prefix === undefined ? localized : `/${prefix}${localized}`;
};
