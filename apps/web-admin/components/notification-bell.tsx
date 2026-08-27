import { getMessage } from "@publira/i18n";
import { BellIcon } from "@publira/icons";
import { Skeleton } from "@publira/ui-components/skeleton";
import Link from "next/link";

import { getLocale, loadAdminMessages } from "#lib/locale";
import { countUnreadNotifications } from "#lib/notification";
import { getTenantId } from "#lib/tenant-id";

export const NotificationBellSkeleton = () => (
  <span
    aria-hidden="true"
    className="inline-flex size-9 items-center justify-center"
  >
    <Skeleton className="size-5 rounded" />
  </span>
);

/**
 * The header's unread badge, with its accessible name.
 *
 * The unread count and the wording that reports it belong together: the name
 * is an `aria-label`, so it cannot stream as a node the way the rest of the
 * shell's copy does, and it has to be resolved wherever the count is. The
 * caller wraps this in a `<Suspense>` with {@link NotificationBellSkeleton}.
 */
export const NotificationBell = async () => {
  const tenantId = await getTenantId();
  const [unread, locale] = await Promise.all([
    countUnreadNotifications(tenantId),
    getLocale(tenantId),
  ]);
  const messages = await loadAdminMessages(locale);
  const count = Math.max(0, unread.unreadCount);
  const label =
    count > 0
      ? getMessage(messages, "admin.shell.notifications_unread", { count })
      : getMessage(messages, "admin.shell.notifications_none");

  return (
    <Link
      aria-label={label}
      className="relative inline-flex size-9 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted"
      href="/notifications"
    >
      <BellIcon aria-hidden="true" className="size-5" />
      {count > 0 ? (
        <span className="absolute -top-1 -right-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-xs leading-none font-medium text-destructive-foreground">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
};
