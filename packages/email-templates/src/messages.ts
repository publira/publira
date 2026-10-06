import { bindMessages } from "@publira/i18n";
import type {
  Locale,
  MessageAccessor,
  MessageKey,
  MessageValues,
} from "@publira/i18n";
import { loadLocaleMessages } from "@publira/i18n/messages";

// Type-only JSON imports cannot take import attributes (TS2857).
import type jaCatalog from "../../../locales/ja.json";

type EmailCatalog = typeof jaCatalog;

export type EmailMessageKey = MessageKey<EmailCatalog>;

/**
 * One locale's copy, bound to that locale so every string a template takes
 * from it is formatted in the language it is written in.
 */
export type Messages = MessageAccessor<EmailCatalog>;

/**
 * Load one locale from the repo-root catalog. The generated registry keeps
 * static import specifiers in one place (see `locales/README.md`).
 */
export const loadEmailMessages = async (locale: Locale): Promise<Messages> =>
  bindMessages((await loadLocaleMessages(locale)) as EmailCatalog, locale);

export const emailMessage = (
  messages: Messages,
  key: EmailMessageKey,
  values?: MessageValues
): string => messages(key, values);
