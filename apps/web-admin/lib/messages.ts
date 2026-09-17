import { bindMessages } from "@publira/i18n";
import type { Locale, MessageAccessor, MessageKey } from "@publira/i18n";
import type { SharedMessages } from "@publira/i18n/catalog";
import { loadLocaleMessages } from "@publira/i18n/messages";

/** Every generated locale catalog has the same key set (`locales/README.md`). */
export type AdminMessages = SharedMessages;

/** Dotted key of any string in the catalog, checked at the call site. */
export type AdminMessageKey = MessageKey<AdminMessages>;

/** The catalog bound to one locale — what `getMessages()` answers with. */
export type AdminMessageAccessor = MessageAccessor<AdminMessages>;

/**
 * The message catalog for `locale`.
 *
 * This module is safe to import from both Server and Client Components. Server
 * locale resolution stays in `locale.ts`, where its `cookies()` dependency
 * cannot leak into client bundles.
 */
export const loadAdminMessages = (locale: Locale): Promise<AdminMessages> =>
  loadLocaleMessages(locale) as Promise<AdminMessages>;

/**
 * The part of the catalog a Client Component renders from. It is written into
 * the RSC payload of every console page, so it carries the console's own copy
 * rather than every app's.
 */
export type AdminClientMessages = Pick<AdminMessages, "admin">;

/** Dotted key of a string a Client Component can render. */
export type AdminClientMessageKey = MessageKey<AdminClientMessages>;

/** What `useClientMessages()` answers with. */
export type AdminClientMessageAccessor = MessageAccessor<AdminClientMessages>;

/** The {@link AdminClientMessages} for `locale`, to seed `AdminLocaleProvider`. */
export const loadAdminClientMessages = async (
  locale: Locale
): Promise<AdminClientMessages> => {
  const { admin } = await loadAdminMessages(locale);

  return { admin };
};

/**
 * The accessor for a locale the caller already holds.
 *
 * This is the form for code that cannot resolve the request's locale itself
 * and is handed one instead: a `lib/` mapper called from inside a `"use cache"`
 * scope, where the locale has to be part of the cache key, and a Server Action,
 * where `next/root-params` is unavailable and the tenant id travels in the form
 * (`getActionMessages`). A Server Component uses `getMessages()` from
 * `lib/get-messages.ts`, which resolves the locale for it.
 *
 * What comes back resolves a string. Copy that is rendered as a node is a
 * `<Message>` behind its own `<Suspense>` instead, which is what keeps one
 * string's wait off the rest of the screen.
 */
export const getMessagesFor = async (
  locale: Locale
): Promise<AdminMessageAccessor> =>
  bindMessages(await loadAdminMessages(locale));
