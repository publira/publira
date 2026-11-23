import { createMessage } from "@publira/locale/message";

import { getMessages } from "#lib/get-messages";
import type { AdminMessageKey } from "#lib/locale";

export type { AdminMessageKey } from "#lib/locale";

/**
 * One catalog string, resolved inside the caller's Suspense boundary.
 *
 * Loading the catalog is what suspends, so the caller wraps this in the
 * `<Suspense>` whose fallback stands in for that one string. Every boundary
 * reads the same `[locale]` root parameter and the same cached module, so the
 * count of them costs a page nothing.
 */
export const Message = createMessage<AdminMessageKey>(getMessages);
