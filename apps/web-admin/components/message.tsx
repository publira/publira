import { getMessage } from "@publira/i18n";
import type { MessageValues } from "@publira/i18n";
import { tenant_id } from "next/root-params";

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
 *
 * The tenant id is read straight from the root segment rather than through
 * `getTenantId()`: an operator who has never picked a language reads the
 * console in the tenant's default locale, the same as the header and the
 * notification bell, and a segment this component cannot make sense of is a
 * reason to fall back to `ja` rather than to turn a piece of copy into a 404.
 */
export const Message = async ({ message, values }: MessageProps) => {
  const tenantId = await tenant_id();
  const locale = await getLocale(
    typeof tenantId === "string" ? tenantId : undefined
  );
  const messages = await loadAdminMessages(locale);

  return getMessage(messages, message, values);
};
