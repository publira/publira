import { getMessage } from "@publira/i18n";
import type { MessageValues } from "@publira/i18n";

import { getLocale, loadAdminMessages } from "#lib/locale";
import type { AdminMessageKey } from "#lib/locale";

export type { AdminMessageKey } from "#lib/locale";

interface MessageProps {
  message: AdminMessageKey;
  values?: MessageValues;
}

/**
 * One catalog string, resolved inside the caller's Suspense boundary.
 *
 * Keeping the locale read here lets pages retain their static structure while
 * the request-time cookie and catalog are loading.
 */
export const Message = async ({ message, values }: MessageProps) => {
  const locale = await getLocale();
  const messages = await loadAdminMessages(locale);

  return getMessage(messages, message, values);
};
