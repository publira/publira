import { bindMessages } from "@publira/i18n";
import type { Locale, MessageAccessor, MessageKey } from "@publira/i18n";
import { loadLocaleMessages } from "@publira/i18n/messages";

import type ja from "../../../locales/ja.json";

/** `ja.json` is the source of truth for the key set (`locales/README.md`). */
export type PlatformMessages = typeof ja;

/** Dotted key of any string in the catalog, checked at the call site. */
export type PlatformMessageKey = MessageKey<PlatformMessages>;

/** The catalog bound to one locale — what `getMessages()` answers with. */
export type PlatformMessageAccessor = MessageAccessor<PlatformMessages>;

/**
 * The message catalog for `locale`.
 *
 * This module is safe to import from both Server and Client Components. Server
 * locale resolution stays in `locale.ts`, where its `cookies()` dependency
 * cannot leak into client bundles.
 */
export const loadPlatformMessages = (
  locale: Locale
): Promise<PlatformMessages> =>
  loadLocaleMessages(locale) as Promise<PlatformMessages>;

/**
 * The accessor for a locale the caller already holds.
 *
 * This is the form for code that cannot resolve the request's locale itself
 * and is handed one instead: a `lib/` mapper called from inside a `"use cache"`
 * scope, where the locale has to be part of the cache key, and a Server Action,
 * which resolves the cookie once and passes the value on. A Server Component
 * uses `getMessages()` from `lib/get-messages.ts`, which resolves the locale
 * for it.
 *
 * What comes back resolves a string. Copy that is rendered as a node is a
 * `<Message>` behind its own `<Suspense>` instead, which is what keeps one
 * string's wait off the rest of the screen.
 */
export const getMessagesFor = async (
  locale: Locale
): Promise<PlatformMessageAccessor> =>
  bindMessages(await loadPlatformMessages(locale));
