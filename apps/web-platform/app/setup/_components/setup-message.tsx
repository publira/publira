import { getMessage } from "@publira/i18n";

import type { MessageProps } from "#components/message";
import { getInitialLocaleCandidate } from "#lib/initial-locale";
import { loadPlatformMessages } from "#lib/locale";

/**
 * One catalog string on the initial setup screen.
 *
 * `<Message>` resolves the locale the console is configured for, which `/setup`
 * has no answer to yet: it only runs before the first operator exists, so there
 * is no `publira_locale` cookie and no settings row to read a default from.
 * This screen therefore opens in the language the request's `Accept-Language`
 * asks for — the same candidate that seeds the form's language selector, so the
 * copy and the pre-selected option always agree.
 *
 * Wrap it in a `<Suspense>` at the call site, the same as `<Message>`.
 */
export const SetupMessage = async ({ message, values }: MessageProps) => {
  const locale = await getInitialLocaleCandidate();
  const messages = await loadPlatformMessages(locale);

  return getMessage(messages, message, values);
};
