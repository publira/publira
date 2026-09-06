import { getMessage } from "@publira/i18n";
import { Badge } from "@publira/ui-components/badge";

import { countPendingComments } from "#lib/comment";
import { getLocale, loadAdminMessages } from "#lib/locale";
import { getTenantId } from "#lib/tenant-id";

/**
 * How many comments are waiting for approval, beside the moderation entry in
 * the navigation.
 *
 * Nothing is rendered when the queue is empty or when the count could not be
 * read: the badge exists to make a growing queue noticeable, and a "0" on
 * every screen is the opposite of that. A failed read is silent for the same
 * reason the header bell's is — the count is chrome, and the moderation screen
 * reports what is actually wrong when the operator opens it.
 *
 * The number carries its own accessible name, because "12" on its own tells a
 * screen reader nothing and an `aria-label` cannot stream in as a node.
 */
export const PendingCommentBadge = async () => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const [result, messages] = await Promise.all([
    countPendingComments(tenantId, locale),
    loadAdminMessages(locale),
  ]);

  const count = Math.max(0, result.pendingCount);
  if (!result.ok || count === 0) {
    return null;
  }

  return (
    <Badge
      aria-label={getMessage(messages, "admin.nav.comments_pending", { count })}
      tone="warning"
      variant="solid"
    >
      {count}
    </Badge>
  );
};
