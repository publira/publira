import type { Locale, MessageKey } from "@publira/i18n";
import type { SharedMessages } from "@publira/i18n/catalog";
import { loadLocaleMessages } from "@publira/i18n/messages";

/** `ja.json` is the source of truth for the key set (`locales/README.md`). */
export type HostMessages = SharedMessages;

/** Dotted key of any string in the catalog, checked at the call site. */
export type HostMessageKey = MessageKey<HostMessages>;

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
