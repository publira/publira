import { getMessage } from "@publira/i18n";
import type { Locale, MessageKey, MessageValues } from "@publira/i18n";
import { loadLocaleMessages } from "@publira/i18n/messages";

// Type-only JSON imports cannot take import attributes (TS2857).
import type jaCatalog from "../../../locales/ja.json";

export type Messages = typeof jaCatalog;

export type EmailMessageKey = MessageKey<Messages>;

/**
 * Load one locale from the repo-root catalog. The generated registry keeps
 * static import specifiers in one place (see `locales/README.md`).
 */
export const loadEmailMessages = (locale: Locale | string): Promise<Messages> =>
  loadLocaleMessages(locale) as Promise<Messages>;

export const emailMessage = (
  messages: Messages,
  key: EmailMessageKey,
  values?: MessageValues
): string => getMessage(messages, key, values);
