import type { Locale, MessageKey } from "@publira/i18n";
import { loadLocaleMessages } from "@publira/i18n/messages";

import type ja from "../../../locales/ja.json";

/** `ja.json` is the source of truth for the key set (`locales/README.md`). */
export type PlatformMessages = typeof ja;

/** Dotted key of any string in the catalog, checked at the call site. */
export type PlatformMessageKey = MessageKey<PlatformMessages>;

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
