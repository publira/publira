import { SkeletonLine } from "@publira/ui-components/skeleton";
import { cn } from "@publira/utils";
import { getMessage } from "@publira/utils/i18n";
import type { MessageKey, MessageValues } from "@publira/utils/i18n";
import { Suspense } from "react";

import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";
import type { PlatformMessages } from "#lib/locale";

/** Dotted key of any string in the catalog, checked at the call site. */
export type PlatformMessageKey = MessageKey<PlatformMessages>;

interface ResolvedMessageProps {
  message: PlatformMessageKey;
  values?: MessageValues;
}

/**
 * The catalog read, on its own. Resolving the locale is request-time work, so
 * this is what suspends — never the surrounding markup.
 */
const ResolvedMessage = async ({ message, values }: ResolvedMessageProps) => {
  const messages = await loadPlatformMessages(await getPlatformLocale());

  return getMessage(messages, message, values);
};

export interface MessageProps extends ResolvedMessageProps {
  /** Sizes the skeleton that stands in for this string. */
  skeletonClassName?: string;
}

/**
 * One catalog string, with its own `<Suspense>` boundary.
 *
 * The alternative — an async section that awaits the catalog and then renders a
 * whole screen — takes the surrounding structure down with it: the inputs, the
 * card, and the buttons all wait on a message they do not depend on. Here the
 * page renders in the static shell and each string streams into a
 * `SkeletonLine` of its own, so the only thing a reader waits for is the text.
 *
 * Every boundary reads the same request-scoped locale and the same cached
 * module, so the count of them costs a page nothing.
 */
export const Message = ({
  message,
  skeletonClassName,
  values,
}: MessageProps) => (
  <Suspense
    fallback={<SkeletonLine className={cn("h-4 w-24", skeletonClassName)} />}
  >
    <ResolvedMessage message={message} values={values} />
  </Suspense>
);
