/**
 * UI locale for web-platform.
 *
 * The console's URLs name no locale: the operator's choice lives in the
 * `publira_locale` cookie, and when that cookie is missing the platform default
 * language saved on the General settings screen answers instead. `proxy.ts`
 * resolves the two on every page request and rewrites it onto the `[locale]`
 * root segment, so a Server Component reads the answer from the URL it was
 * routed to, through {@link getLocale}.
 *
 * {@link getPlatformLocale} resolves the same answer from the cookie, and only
 * where there is no root parameter to read: a Server Action, and the
 * `api/v1/audit-logs/csv` Route Handler. A Server Component, a layout, and
 * `generateMetadata` read {@link getLocale}. Calling {@link getPlatformLocale}
 * from one of them reads `cookies()` and makes that route request-time.
 * `<html lang>` is handled separately, by the inline script in
 * `app/[locale]/layout.tsx` (see `LOCALE_LANG_SCRIPT`), over the cookies
 * `proxy.ts` publishes (`@publira/utils/resolved-locale`).
 */

import {
  isLocale,
  LOCALE_COOKIE_NAME,
  negotiateInitialLocale,
} from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { cookies, headers } from "next/headers";

import { readSetupDefaultLocale } from "./setup-status";

export { getLocale } from "@publira/locale/root-locale";

export {
  loadPlatformMessages,
  type PlatformMessageKey,
  type PlatformMessages,
} from "./messages";

/**
 * The last locale {@link getPlatformDisplayLocale} resolved, for this server
 * process. `undefined` while it has never resolved one — a freshly started
 * instance, or one that has only ever seen the API down. The same shape
 * `resolveSetupState` uses to keep routing through an outage.
 */
let lastConfirmedDisplayLocale: Locale | undefined;

/**
 * Display locale for the platform console itself when the operator has not
 * chosen one in the `publira_locale` cookie.
 *
 * The saved setting is the answer, read from `CheckSetupStatus`: it needs no
 * session and reports the same value `GetPlatformSettings` does, so the login
 * screen renders in the language the platform saved rather than one guessed
 * for whoever is looking at it, and the signed-in console resolves it the same
 * way. Every shared read resolves its locale through here before it calls its
 * cached body, which is why this is not `GetPlatformSettings`: that read
 * itself is one of them.
 *
 * When the read does not answer, {@link lastConfirmedDisplayLocale} carries the
 * console through: an outage does not change what the platform saved, and the
 * operator reading the error screen it produces should not watch the console
 * change language on them.
 *
 * Only a platform that has saved nothing — before setup, or a process that has
 * never had an answer at all — falls through to `Accept-Language`, where the
 * browser's preference is the one thing that says anything about the operator
 * about to choose a language.
 */
const getPlatformDisplayLocale = async (): Promise<Locale> => {
  const saved = await readSetupDefaultLocale();

  if (saved) {
    lastConfirmedDisplayLocale = saved;

    return saved;
  }

  if (lastConfirmedDisplayLocale) {
    return lastConfirmedDisplayLocale;
  }

  const requestHeaders = await headers();

  return negotiateInitialLocale(requestHeaders.get("accept-language"));
};

/**
 * The locale this request should render in.
 *
 * Resolution is cookie → saved platform default locale. A set, supported
 * cookie always wins, including when it is `ja`; unset, unknown, and malformed
 * values fall through to the platform default, which
 * {@link getPlatformDisplayLocale} resolves without a session — on the login
 * screen as much as in the signed-in console.
 *
 * **Server Actions and Route Handlers only.** A page, a layout, and
 * `generateMetadata` read {@link getLocale}. `cookies()` here is a
 * request-time read, so calling this while rendering a page costs that route
 * its static shell. Never call this from a `"use cache"` scope either — pass
 * the resolved locale in as an argument instead, so it becomes part of the
 * cache key.
 */
export const getPlatformLocale = async (): Promise<Locale> => {
  const cookieStore = await cookies();

  const raw = cookieStore.get(LOCALE_COOKIE_NAME)?.value;

  if (raw !== undefined) {
    const trimmed = raw.trim();

    if (isLocale(trimmed)) {
      return trimmed;
    }
  }

  return getPlatformDisplayLocale();
};
