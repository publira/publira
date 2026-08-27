import type { Locale, MessageKey } from "@publira/i18n";
import type { SharedMessages } from "@publira/i18n/catalog";
import { loadLocaleMessages } from "@publira/i18n/messages";

/** `ja.json` is the source of truth for the key set (`locales/README.md`). */
export type AdminMessages = SharedMessages;

/** Dotted key of any string in the catalog, checked at the call site. */
export type AdminMessageKey = MessageKey<AdminMessages>;

/**
 * The message catalog for `locale`.
 *
 * This module is safe to import from both Server and Client Components. Server
 * locale resolution stays in `locale.ts`, where its `cookies()` dependency
 * cannot leak into client bundles.
 */
export const loadAdminMessages = (locale: Locale): Promise<AdminMessages> =>
  loadLocaleMessages(locale) as Promise<AdminMessages>;
