/**
 * Handing the browser the display locale a console's proxy resolved.
 *
 * A cookie console keeps the operator's own choice in `publira_locale`, and the
 * server resolves everything else from the stored default — the platform's in
 * `web-platform`, the tenant's in `web-admin`. Two places in the browser cannot
 * reach that default: `<html lang>`, which a root layout cannot read without
 * costing every route its static shell, and the client error boundary, which
 * renders exactly when the API holding the value is unreachable. Both would
 * otherwise fall back to `Accept-Language` and answer an outage in the
 * visitor's language rather than the console's.
 *
 * Each proxy already reads that default to route the request — the setup status
 * in `web-platform`, the Host-to-tenant resolution in `web-admin` — so the value
 * is written to a cookie of its own from there. This module is the shared half
 * of that: it takes the locale the caller resolved and never resolves one
 * itself, which is what keeps it out of `next/headers` and reachable from a
 * proxy.
 */

import {
  LOCALE_COOKIE_MAX_AGE,
  RESOLVED_LOCALE_COOKIE_NAME,
} from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import type { NextRequest, NextResponse } from "next/server";

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
 * Publish `defaultLocale` on `response`, unless the request already carries it.
 *
 * Skipping the write when nothing changed keeps `Set-Cookie` off every console
 * response; a console whose default language is edited publishes the new value
 * on the very next request, because the proxy re-reads it on each one.
 *
 * A `null` locale writes nothing at all. That is the state before a language
 * has been saved, and a console with none has none to name — the screen that
 * runs then negotiates its own from `Accept-Language`, and a cookie invented
 * here would only turn that negotiation into a stored answer.
 */
export const applyResolvedLocaleCookie = (
  request: NextRequest,
  response: NextResponse,
  defaultLocale: Locale | null
): NextResponse => {
  if (!defaultLocale) {
    return response;
  }

  const current = request.cookies.get(RESOLVED_LOCALE_COOKIE_NAME)?.value;
  if (current === defaultLocale) {
    return response;
  }

  response.cookies.set(
    RESOLVED_LOCALE_COOKIE_NAME,
    defaultLocale,
    resolvedLocaleCookieOptions
  );

  return response;
};
