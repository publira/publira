import { loadMessages } from "@publira/utils/i18n";
import type { Locale, MessageKey } from "@publira/utils/i18n";

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
  loadMessages<PlatformMessages>(locale, {
    en: () => import("../../../locales/en.json", { with: { type: "json" } }),
    ja: () => import("../../../locales/ja.json", { with: { type: "json" } }),
  });
