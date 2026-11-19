import type { MessageValues } from "@publira/i18n";

import { getMessages } from "#lib/get-messages";
import type { AdminMessageKey } from "#lib/messages";

export type { AdminMessageKey } from "#lib/locale";

interface MessageProps {
  message: AdminMessageKey;
  values?: MessageValues;
}

/**
 * One catalog string, resolved inside the caller's Suspense boundary.
 *
 * Loading the catalog is what suspends, so the caller wraps this in the
 * `<Suspense>` whose fallback stands in for that one string. Every boundary
 * reads the same `[locale]` root parameter and the same cached module, so the
 * count of them costs a page nothing.
 */
export const Message = async ({ message, values }: MessageProps) => {
  const t = await getMessages();

  return t(message, values);
};
