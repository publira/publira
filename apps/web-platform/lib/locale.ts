/**
 * UI locale for web-platform.
 *
 * The console has no dynamic segment, so the locale is not in the URL: it lives
 * in the `publira_locale` cookie. When that cookie is missing, the platform
 * default language saved on the General settings screen answers instead.
 * `cookies()` is a request-time read, so every caller of
 * {@link getPlatformLocale} must sit inside a `<Suspense>` boundary — reading
 * it above one would leave the route with no static shell under Cache
 * Components. `<html lang>` is handled separately, by the inline script in
 * `app/layout.tsx` (see `LOCALE_LANG_SCRIPT`), over the cookies `proxy.ts`
 * publishes (`lib/resolved-locale.ts`).
 */

import {
  isLocale,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
} from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { cookies } from "next/headers";

import { getPlatformDisplayLocale } from "./platform-settings";

export {
  loadPlatformMessages,
  type PlatformMessageKey,
  type PlatformMessages,
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
 * treated as a choice and the saved platform default is used instead.
 */
export const platformLocaleCookieOptions = {
  httpOnly: false as const,
  maxAge: LOCALE_COOKIE_MAX_AGE,
  path: "/" as const,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};

/**
 * The locale this request should render in.
 *
 * Resolution is cookie → saved platform default locale. A set, supported
 * cookie always wins, including when it is `ja`; unset, unknown, and malformed
 * values fall through to the platform default, which
 * {@link getPlatformDisplayLocale} resolves without a session too — on the
 * login screen, for instance, where the setup status carries the same saved
 * value.
 *
 * **Inside `<Suspense>` only.** Never call this from a `"use cache"` scope
 * either — pass the resolved locale in as an argument instead, so it becomes
 * part of the cache key.
 */
export const getPlatformLocale = async (): Promise<Locale> => {
  const cookieStore = await cookies();

  const raw = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (isLocale(trimmed)) {
      return trimmed;
    }
  }

  return getPlatformDisplayLocale();
};
