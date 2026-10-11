import { bindMessages } from "@publira/i18n";
import type { Locale, MessageAccessor, MessageKey } from "@publira/i18n";
import type { SharedMessages } from "@publira/i18n/catalog";
import { loadLocaleMessages } from "@publira/i18n/messages";

/** `ja.json` is the source of truth for the key set (`locales/README.md`). */
export type StorefrontMessages = SharedMessages;

/** Dotted key of any string in the catalog, checked at the call site. */
export type StorefrontMessageKey = MessageKey<StorefrontMessages>;

/** The catalog bound to one locale — what `getMessages()` answers with. */
export type StorefrontMessageAccessor = MessageAccessor<StorefrontMessages>;

/**
 * The message catalog for `locale`.
 *
 * This module is safe to import from both Server and Client Components. The
 * locale itself is resolved elsewhere — `lib/locale.ts` on the server, where
 * its `next/root-params` dependency cannot leak into a client bundle, and
 * `components/locale-context.tsx` in the browser.
 */
export const loadStorefrontMessages = (
  locale: Locale
): Promise<StorefrontMessages> =>
  loadLocaleMessages(locale) as Promise<StorefrontMessages>;

/**
 * The part of the catalog a Client Component renders from. It is written into
 * the RSC payload of every page, so it carries `storefront` rather than every
 * app's copy.
 */
export type StorefrontClientCatalog = Pick<StorefrontMessages, "storefront">;

/** Dotted key of a string a Client Component can render. */
export type StorefrontClientMessageKey = MessageKey<StorefrontClientCatalog>;

/** What `useClientMessages()` answers with. */
export type StorefrontClientMessageAccessor =
  MessageAccessor<StorefrontClientCatalog>;

/**
 * What `StorefrontMessagesProvider` hands down: the
 * {@link StorefrontClientCatalog} and the locale it is written in, which the
 * accessor formats in. The provider sits above the layout that places
 * `LocaleProvider`, so the locale travels with the catalog rather than being
 * read from beside it.
 */
export interface StorefrontClientMessages {
  readonly catalog: StorefrontClientCatalog;
  readonly locale: Locale;
}

/** The {@link StorefrontClientMessages} for `locale`, to seed `StorefrontMessagesProvider`. */
export const loadStorefrontClientMessages = async (
  locale: Locale
): Promise<StorefrontClientMessages> => {
  const { storefront } = await loadStorefrontMessages(locale);

  return { catalog: { storefront }, locale };
};

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
): Promise<StorefrontMessageAccessor> =>
  bindMessages(await loadStorefrontMessages(locale), locale);
