import { getMessage } from "@publira/i18n";
import type { MessageValues } from "@publira/i18n";

import { getLocale, loadAdminMessages } from "#lib/locale";
import type { AdminMessageKey } from "#lib/locale";
import { getTenantId } from "#lib/tenant-id";

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
 * An operator who has never picked a language reads the console in the
 * tenant's default locale, the same as the header and the notification bell,
 * so this resolves the tenant the ordinary way. A segment that names no tenant
 * has no default to read and no language to render this string in, and
 * `getTenantId()` answers that with the 404 the route was heading for anyway.
 */
export const Message = async ({ message, values }: MessageProps) => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const messages = await loadAdminMessages(locale);

  return getMessage(messages, message, values);
};
