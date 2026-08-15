import { getMessage, loadMessages } from "@publira/utils/i18n";
import type { Locale, MessageKey, MessageValues } from "@publira/utils/i18n";

// Type-only JSON imports cannot take import attributes (TS2857).
import type jaCatalog from "../../../locales/ja.json";

export type Messages = typeof jaCatalog;

export type EmailMessageKey = MessageKey<Messages>;

/**
 * Load one locale from the repo-root catalog. Specifiers stay static so a
 * bundler can split them; adding a locale is a new importer here plus
 * `locales/<code>.json` (see `locales/README.md`).
 */
export const loadEmailMessages = (locale: Locale | string): Promise<Messages> =>
  loadMessages<Messages>(locale, {
    en: () => import("../../../locales/en.json", { with: { type: "json" } }),
    ja: () => import("../../../locales/ja.json", { with: { type: "json" } }),
  });

export const emailMessage = (
  messages: Messages,
  key: EmailMessageKey,
  values?: MessageValues
): string => getMessage(messages, key, values);
