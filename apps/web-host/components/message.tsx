import type { MessageValues } from "@publira/i18n";

import { getMessages } from "#lib/get-messages";
import type { HostMessageKey } from "#lib/messages";

export interface MessageProps {
  message: HostMessageKey;
  values?: MessageValues;
}

/**
 * One catalog string.
 *
 * The locale is a root parameter here rather than a cookie, so resolving it
 * costs nothing; the `import()` of the catalog is what suspends. The caller
 * wraps this in the `<Suspense>` whose fallback stands in for that one string:
 *
 * ```tsx
 * <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
 *   <Message message="host.top.view_all" />
 * </Suspense>
 * ```
 *
 * The alternative — an async section that awaits the catalog and then renders a
 * whole screen — takes the surrounding structure down with it: the cards, the
 * headings, and the links all wait on a message they do not depend on.
 */
export const Message = async ({ message, values }: MessageProps) => {
  const t = await getMessages();

  return t(message, values);
};
