/**
 * UI locale for web-admin.
 *
 * The console rewrites onto `/[tenant_id]/...` and never puts the locale in
 * the URL: it lives in the `publira_locale` cookie, the same name and parser
 * as web-platform. When that cookie is missing, an authenticated request
 * that passes the tenant id falls through to the tenant's default locale
 * (#1046). Unauthenticated screens cannot call the admin API, so they omit
 * the tenant id and stay on `ja`.
 *
 * `cookies()` is a request-time read, so every caller of {@link getLocale}
 * must sit inside a `<Suspense>` boundary — reading it in
 * `app/[tenant_id]/layout.tsx` would leave the tenant tree without a static
 * shell under Cache Components. `<html lang>` is handled separately, by the
 * inline script in that layout (see `LOCALE_LANG_SCRIPT`).
 */

import {
  DEFAULT_LOCALE,
  isLocale,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
} from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { cookies } from "next/headers";

import { getAccessToken } from "./session";
import { getTenantDisplayLocale } from "./tenant-default-locale";
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
 * `httpOnly` is deliberately off: the inline `<head>` script reads this cookie
 * to set `<html lang>` before the first paint, which it can only do from
 * `document.cookie`. The value is a two-letter UI preference chosen from a
 * fixed list — nothing an attacker gains by reading, and the server re-parses
 * it against {@link isLocale} on every request, so a hand-edited value is not
 * treated as a choice and the tenant default (or `ja`) is used instead.
 */
export const adminLocaleCookieOptions = {
  httpOnly: false as const,
  maxAge: LOCALE_COOKIE_MAX_AGE,
  path: "/" as const,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};

/**
 * Cookie-less fallback: the tenant's default locale when the session can
 * reach the admin API, otherwise {@link DEFAULT_LOCALE}. Login and other
 * unauthenticated screens stay on `ja` because they cannot call that API.
 */
const resolveTenantFallbackLocale = async (
  tenantId: string
): Promise<Locale> => {
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return DEFAULT_LOCALE;
  }

  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId || !isTenantIdFormat(normalizedTenantId)) {
    return DEFAULT_LOCALE;
  }

  return getTenantDisplayLocale(normalizedTenantId);
};

/**
 * The locale this request should render in.
 *
 * Resolution is cookie → tenant default locale → `ja`. A set, supported cookie
 * always wins, including when it is `ja`; only an unset or unsupported value
 * falls through to the tenant default, and only when `tenantId` is passed.
 * Unauthenticated screens omit `tenantId` so they stay on {@link DEFAULT_LOCALE}.
 *
 * **Inside `<Suspense>` only.** Never call this from a `"use cache"` scope
 * either — pass the resolved locale in as an argument instead, so it becomes
 * part of the cache key. Server Actions read `cookies()` themselves rather
 * than going through this helper.
 */
export const getLocale = async (tenantId?: string): Promise<Locale> => {
  const cookieStore = await cookies();
  const raw = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (isLocale(trimmed)) {
      return trimmed;
    }
  }

  if (!tenantId) {
    return DEFAULT_LOCALE;
  }

  return resolveTenantFallbackLocale(tenantId);
};
