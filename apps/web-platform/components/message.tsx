import { getMessage } from "@publira/utils/i18n";
import type { MessageValues } from "@publira/utils/i18n";

import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";
import type { PlatformMessageKey } from "#lib/locale";

export type { PlatformMessageKey } from "#lib/locale";

export interface MessageProps {
  message: PlatformMessageKey;
  values?: MessageValues;
}

/**
 * One catalog string.
 *
 * Resolving the locale is request-time work, so this is what suspends, and the
 * caller wraps it in the `<Suspense>` whose fallback stands in for that one
 * string:
 *
 * ```tsx
 * <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
 *   <Message message="platform.auth.login.submit" />
 * </Suspense>
 * ```
 *
 * The alternative — an async section that awaits the catalog and then renders a
 * whole screen — takes the surrounding structure down with it: the inputs, the
 * card, and the buttons all wait on a message they do not depend on. Every
 * boundary reads the same request-scoped locale and the same cached module, so
 * the count of them costs a page nothing.
 */
export const Message = async ({ message, values }: MessageProps) => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  return getMessage(messages, message, values);
};
