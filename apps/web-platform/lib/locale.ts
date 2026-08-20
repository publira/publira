/**
 * UI locale for web-platform.
 *
 * The console has no dynamic segment, so the locale is not in the URL: it lives
 * in the `publira_locale` cookie. `cookies()` is a request-time read, so every
 * caller of {@link getPlatformLocale} must sit inside a `<Suspense>` boundary —
 * reading it above one would leave the route with no static shell under Cache
 * Components. `<html lang>` is handled separately, by the inline script in
 * `app/layout.tsx` (see `LOCALE_LANG_SCRIPT`).
 */

import {
  loadMessages,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
  parseLocaleCookie,
} from "@publira/utils/i18n";
import type { Locale } from "@publira/utils/i18n";
import { cookies } from "next/headers";

import type ja from "../../../locales/ja.json";

/** `ja.json` is the source of truth for the key set (`locales/README.md`). */
export type PlatformMessages = typeof ja;

/**
 * Options the locale cookie is written with, from the Server Action in
 * `lib/locale-action.ts`.
 *
 * `httpOnly` is deliberately off: the inline `<head>` script reads this cookie
 * to set `<html lang>` before the first paint, which it can only do from
 * `document.cookie`. The value is a two-letter UI preference chosen from a
 * fixed list — nothing an attacker gains by reading, and the server re-parses
 * it against {@link parseLocaleCookie} on every request, so a hand-edited value
 * falls back to `ja` rather than reaching application code.
 */
export const platformLocaleCookieOptions = {
  httpOnly: false as const,
  maxAge: LOCALE_COOKIE_MAX_AGE,
  path: "/" as const,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};

/**
 * The locale this request should render in. Unset, unknown, and malformed
 * cookie values all resolve to `ja`.
 *
 * **Inside `<Suspense>` only.** Never call this from a `"use cache"` scope
 * either — pass the resolved locale in as an argument instead, so it becomes
 * part of the cache key.
 */
export const getPlatformLocale = async (): Promise<Locale> => {
  const cookieStore = await cookies();

  return parseLocaleCookie(cookieStore.get(LOCALE_COOKIE_NAME)?.value);
};

/**
 * The message catalog for `locale`.
 *
 * One static `import()` per locale, never a template-string path, so the
 * bundler keeps the locale that was not asked for out of the chunk.
 */
export const loadPlatformMessages = (
  locale: Locale
): Promise<PlatformMessages> =>
  loadMessages<PlatformMessages>(locale, {
    en: () => import("../../../locales/en.json", { with: { type: "json" } }),
    ja: () => import("../../../locales/ja.json", { with: { type: "json" } }),
  });
