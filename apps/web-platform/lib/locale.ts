/**
 * UI locale for web-platform.
 *
 * The console has no dynamic segment, so the locale is not in the URL: it lives
 * in the `publira_locale` cookie. When that cookie is missing, an
 * authenticated request falls through to the platform default locale set in
 * `設定 > 一般` (#1047). `cookies()` is a request-time read, so every caller of
 * {@link getPlatformLocale} must sit inside a `<Suspense>` boundary — reading
 * it above one would leave the route with no static shell under Cache
 * Components. `<html lang>` is handled separately, by the inline script in
 * `app/layout.tsx` (see `LOCALE_LANG_SCRIPT`).
 */

import {
  isLocale,
  loadMessages,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
} from "@publira/utils/i18n";
import type { Locale, MessageKey } from "@publira/utils/i18n";
import { cookies } from "next/headers";

import type ja from "../../../locales/ja.json";
import { getPlatformDisplayLocale } from "./platform-settings";

/** `ja.json` is the source of truth for the key set (`locales/README.md`). */
export type PlatformMessages = typeof ja;

/** Dotted key of any string in the catalog, checked at the call site. */
export type PlatformMessageKey = MessageKey<PlatformMessages>;

/**
 * Options the locale cookie is written with, from the Server Action in
 * `lib/locale-action.ts`.
 *
 * `httpOnly` is deliberately off: the inline `<head>` script reads this cookie
 * to set `<html lang>` before the first paint, which it can only do from
 * `document.cookie`. The value is a two-letter UI preference chosen from a
 * fixed list — nothing an attacker gains by reading, and the server re-parses
 * it against {@link isLocale} on every request, so a hand-edited value is not
 * treated as a choice and the platform default (or `ja`) is used instead.
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
 * Resolution is cookie → platform default locale → `ja`. A set, supported
 * cookie always wins, including when it is `ja`; unset, unknown, and malformed
 * values fall through to the platform default, which itself degrades to `ja`
 * when the settings read is unavailable — on the login screen, for instance,
 * where there is no session to read it with.
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
