import { bindMessages } from "@publira/i18n";
import type { Locale, MessageAccessor, MessageKey } from "@publira/i18n";
import type { SharedMessages } from "@publira/i18n/catalog";
import { loadLocaleMessages } from "@publira/i18n/messages";

/** `ja.json` is the source of truth for the key set (`locales/README.md`). */
export type HostMessages = SharedMessages;

/** Dotted key of any string in the catalog, checked at the call site. */
export type HostMessageKey = MessageKey<HostMessages>;

/** The catalog bound to one locale — what `getMessages()` answers with. */
export type HostMessageAccessor = MessageAccessor<HostMessages>;

/**
 * The message catalog for `locale`.
 *
 * This module is safe to import from both Server and Client Components. The
 * locale itself is resolved elsewhere — `lib/locale.ts` on the server, where
 * its `next/root-params` dependency cannot leak into a client bundle, and
 * `components/locale-provider.tsx` in the browser.
 */
export const loadHostMessages = (locale: Locale): Promise<HostMessages> =>
  loadLocaleMessages(locale) as Promise<HostMessages>;

/**
 * The accessor for a locale the caller already holds.
 *
 * This is the form for code that cannot resolve the request's locale itself
 * and is handed one instead: a `lib/` mapper called from inside a `"use cache"`
 * scope, where the locale has to be part of the cache key, and a Server Action,
 * where `next/root-params` is unavailable. A Server Component uses
 * `getMessages()` from `lib/get-messages.ts`, which resolves the locale for it.
 *
 * What comes back resolves a string. Copy that is rendered as a node is a
 * `<Message>` behind its own `<Suspense>` instead, which is what keeps one
 * string's wait off the rest of the screen.
 */
export const getMessagesFor = async (
  locale: Locale
): Promise<HostMessageAccessor> => bindMessages(await loadHostMessages(locale));
