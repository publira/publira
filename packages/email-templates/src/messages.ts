import { bindMessages } from "@publira/i18n";
import type {
  Locale,
  MessageAccessor,
  MessageKey,
  MessageValues,
} from "@publira/i18n";
import type { SharedMessages } from "@publira/i18n/catalog";
import { loadLocaleMessages } from "@publira/i18n/messages";

// The published catalog type, not a JSON import of the catalog: the built
// declarations are emitted by Oxc, which cannot declare a JSON module.
type EmailCatalog = SharedMessages;

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
  // SAFETY: `loadLocaleMessages` resolves one of the `locales/*.json` catalogs
  // that `SharedMessages` is the union of.
  bindMessages((await loadLocaleMessages(locale)) as EmailCatalog, locale);

export const emailMessage = (
  messages: Messages,
  key: EmailMessageKey,
  values?: MessageValues
): string => messages(key, values);
