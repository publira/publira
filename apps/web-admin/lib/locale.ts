/**
 * UI locale for web-admin.
 *
 * The console's URLs name no locale: the operator's choice lives in the
 * `publira_locale` cookie, the same name and parser as web-platform, and when
 * that cookie is missing the tenant's stored default locale answers instead.
 * `proxy.ts` resolves the two on every page request and rewrites it onto the
 * `[locale]` root segment below `[tenant_id]`, so a Server Component reads the
 * answer from the URL it was routed to, through {@link getLocale}.
 *
 * {@link getAdminLocale} resolves the same answer from the cookie and the
 * public `GetTenant`, and only where there is no root parameter to read: a
 * Server Action and a Route Handler. A Server Component, a layout, and
 * `generateMetadata` read {@link getLocale}. Calling {@link getAdminLocale}
 * from one of them reads `cookies()` and makes that route request-time.
 * Nothing here names a language of its own: a tenant whose default cannot be
 * read is an outage the screen reports, not a reason to pick one.
 * `<html lang>` is handled separately, by the inline script in
 * `app/[tenant_id]/[locale]/layout.tsx` (see `LOCALE_LANG_SCRIPT`).
 */

import {
  isLocale,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
} from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { locale as rootLocale } from "next/root-params";

import { getTenantDisplayLocale } from "./public-api";
import { isTenantIdFormat } from "./tenant-id-format";

export {
  type AdminMessageKey,
  type AdminMessages,
  loadAdminMessages,
} from "./messages";

/**
 * Options the locale cookie is written with, from the Server Action in
 * `lib/locale-action.ts`.
 *
 * `Path=/` and no tenant in the name, so a host that serves several tenants
 * carries one cookie for all of them. That is the useful scope: the value is
 * the operator's own reading preference, not something a tenant owns, and the
 * tenant's saved default is what the console falls through to when it is unset.
 *
 * `httpOnly` is deliberately off: the inline `<head>` script reads this cookie
 * to set `<html lang>` before the first paint, which it can only do from
 * `document.cookie`. The value is a two-letter UI preference chosen from a
 * fixed list — nothing an attacker gains by reading, and the server re-parses
 * it against {@link isLocale} on every request, so a hand-edited value is not
 * treated as a choice and the tenant default is used instead.
 */
export const adminLocaleCookieOptions = {
  httpOnly: false as const,
  maxAge: LOCALE_COOKIE_MAX_AGE,
  path: "/" as const,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};

/**
 * The locale this request should render in, from the cookie.
 *
 * Resolution is cookie → the tenant's stored default locale. A set, supported
 * cookie always wins, including when it is `ja`; only an unset or unsupported
 * value falls through to the default, which the public `GetTenant` answers
 * without a session so an unauthenticated screen resolves it too.
 *
 * There is no third step. A tenant id that is not one, or a default locale the
 * console cannot read, throws: rendering the operator a console in a language
 * nobody chose would hide the failure behind chrome that looks like it worked.
 *
 * It is the same answer `proxy.ts` rewrote the request onto, so a page reads
 * {@link getLocale} instead. `tenantId` is the caller's to supply: a Server
 * Action takes it from the form (`getActionLocale`), and a Route Handler from
 * the request it is serving.
 *
 * **Server Actions and Route Handlers only.** A page, a layout, and
 * `generateMetadata` read {@link getLocale}. `cookies()` here is a
 * request-time read, so calling this while rendering a page costs that route
 * its static shell. Never call this from a `"use cache"` scope either — pass
 * the resolved locale in as an argument instead, so it becomes part of the
 * cache key.
 */
export const getAdminLocale = async (tenantId: string): Promise<Locale> => {
  const cookieStore = await cookies();
  const raw = cookieStore.get(LOCALE_COOKIE_NAME)?.value;

  if (raw !== undefined) {
    const trimmed = raw.trim();

    if (isLocale(trimmed)) {
      return trimmed;
    }
  }

  const normalizedTenantId = tenantId.trim();

  if (!isTenantIdFormat(normalizedTenantId)) {
    throw new Error(`not a tenant id: ${tenantId}`);
  }

  return getTenantDisplayLocale(normalizedTenantId);
};

/**
 * The locale this request is rendered in, from the `[locale]` root segment
 * `proxy.ts` rewrote it onto.
 *
 * Resolving it costs nothing and the value is part of the route, so it is
 * already in every cache key below it: a `"use cache"` scope may call this
 * directly, and a Server Component that does needs no `<Suspense>` for it.
 *
 * An unsupported segment is a 404. The proxy only ever writes a supported
 * locale below the tenant id, so the only way to arrive here with anything
 * else is a URL that does not exist.
 *
 * Note: `next/root-params` is not available in Server Actions or Route
 * Handlers; those resolve the locale with {@link getAdminLocale}.
 */
export const getLocale = async (): Promise<Locale> => {
  const value = await rootLocale();

  if (!isLocale(value)) {
    notFound();
  }

  return value;
};
