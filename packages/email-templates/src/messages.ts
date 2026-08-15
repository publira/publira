import { getMessage, parseLocale } from "@publira/utils/i18n";
import type { Locale, MessageKey, MessageValues } from "@publira/utils/i18n";

import en from "./messages/en.json";
import ja from "./messages/ja.json";

export type EmailMessages = typeof ja;

const catalogs = {
  en,
  ja,
} as const satisfies Record<Locale, EmailMessages>;

export const emailMessage = (
  locale: Locale | string,
  key: MessageKey<EmailMessages>,
  values?: MessageValues
): string => getMessage(catalogs[parseLocale(locale)], key, values);
