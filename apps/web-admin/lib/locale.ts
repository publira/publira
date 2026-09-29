/**
 * UI locale for web-admin.
 *
 * The console rewrites onto `/[tenant_id]/...` and never puts the locale in
 * the URL: it lives in the `publira_locale` cookie, the same name and parser
 * as web-platform. When that cookie is missing, the request falls through to
 * the tenant's stored default locale — read from the public
 * `GetTenant`, so the login screen and every other unauthenticated screen
 * resolve the same value the signed-in console does. Nothing here names a
 * language of its own: a tenant whose default cannot be read is an outage the
 * screen reports, not a reason to pick one.
 *
 * `cookies()` is a request-time read, so every caller of {@link getLocale}
 * must sit inside a `<Suspense>` boundary — reading it in
 * `app/[tenant_id]/layout.tsx` would leave the tenant tree without a static
 * shell under Cache Components. `<html lang>` is handled separately, by the
 * inline script in that layout (see `LOCALE_LANG_SCRIPT`).
 */

import {
  isLocale,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
} from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { cookies } from "next/headers";

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
 * The locale this request should render in.
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
 * `tenantId` is the caller's to supply, because where it comes from differs:
 * a Server Component reads the `tenant_id` root parameter (`getTenantId()`),
 * and a Server Action, which has no root parameters, takes it from the form
 * (`getActionLocale`). Keeping `next/root-params` out of this module is what
 * lets both use it.
 *
 * **Inside `<Suspense>` only.** Never call this from a `"use cache"` scope
 * either — pass the resolved locale in as an argument instead, so it becomes
 * part of the cache key.
 */
export const getLocale = async (tenantId: string): Promise<Locale> => {
  const cookieStore = await cookies();
  const raw = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  if (typeof raw === "string") {
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
