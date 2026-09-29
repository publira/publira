/**
 * Handing the browser the display locale a console's proxy resolved.
 *
 * A cookie console keeps the operator's own choice in `publira_locale`, and the
 * server resolves everything else from the stored default — the platform's in
 * `web-platform`, the tenant's in `web-admin` and `web-host`. Two places in the
 * browser cannot reach that default: `<html lang>`, which a root layout cannot
 * read without settling the whole tree before anything below it can flush, and
 * the client error boundary, which renders exactly when the API holding the
 * value is unreachable. Both would otherwise fall back to `Accept-Language` and
 * answer an outage in the visitor's language rather than the site's.
 *
 * Each proxy already reads that default to route the request — the setup status
 * in `web-platform`, the Host-to-tenant resolution in `web-admin` and
 * `web-host` — so the value is written to a cookie of its own from there. This
 * module is the shared half of that: it takes the locale the caller resolved
 * and never resolves one itself, which is what keeps it out of `next/headers`
 * and reachable from a proxy.
 */

import {
  LOCALE_COOKIE_MAX_AGE,
  RESOLVED_LOCALE_COOKIE_NAME,
} from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import type { NextRequest, NextResponse } from "next/server";

/**
 * What the proxy resolved about the console's stored display language.
 *
 * The two non-locale states are not the same thing and must not be collapsed:
 * an answer that names no supported language replaces what the browser holds,
 * while a read that failed says nothing about it at all.
 *
 * - a {@link Locale} — publish it.
 * - `"none"` — the API answered, and it has saved no language this build
 *   can render. Anything the browser still carries is stale and is cleared: a
 *   console whose saved code has no catalog must not have the previous language
 *   published on its behalf. It is also the state before a language has been
 *   saved at all, where nothing is written because there is nothing to clear —
 *   the setup screen negotiates its own from `Accept-Language`, and a cookie
 *   invented here would only turn that negotiation into a stored answer.
 * - `"unknown"` — the read failed. An outage did not change what the console
 *   saved, so the cookie is left exactly as it is, including the one an earlier
 *   process published before this one started.
 */
export type ResolvedLocaleState = Locale | "none" | "unknown";

/**
 * Options the resolved-locale cookie is written with.
 *
 * `httpOnly` is off for the same reason the chosen locale's is: the inline
 * `<head>` script and the client error boundary read it from `document.cookie`,
 * which is the whole point of writing it. It holds a two-letter code the
 * console itself published, so it discloses nothing, and no server path reads
 * it back — the server resolves the setting directly.
 */
export const resolvedLocaleCookieOptions = {
  httpOnly: false as const,
  maxAge: LOCALE_COOKIE_MAX_AGE,
  path: "/" as const,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};

/**
 * Publish `state` on `response`, unless the request already carries the answer.
 *
 * Skipping the write when nothing changed keeps `Set-Cookie` off every console
 * response; a console whose default language is edited publishes the new value
 * on the very next request, because the proxy re-reads it on each one, and one
 * that stops naming a supported language has the stale cookie expired on that
 * same request.
 *
 * The cookie is a copy of a server-resolved value and no server path reads it
 * back, so nothing here touches the request headers the proxy forwards: the app
 * behind them resolves the setting itself.
 */
export const applyResolvedLocaleCookie = (
  request: NextRequest,
  response: NextResponse,
  state: ResolvedLocaleState
): NextResponse => {
  if (state === "unknown") {
    return response;
  }

  const current = request.cookies.get(RESOLVED_LOCALE_COOKIE_NAME)?.value;

  if (state === "none") {
    if (current !== undefined) {
      response.cookies.delete(RESOLVED_LOCALE_COOKIE_NAME);
    }
    return response;
  }

  if (current === state) {
    return response;
  }

  response.cookies.set(
    RESOLVED_LOCALE_COOKIE_NAME,
    state,
    resolvedLocaleCookieOptions
  );

  return response;
};
