import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { countUnreadNotifications, listNotifications } from "#lib/notification";
import { getTenantId } from "#lib/tenant-id";

import {
  NotificationBellContent,
  NotificationBellEmpty,
  NotificationBellEmptyDescription,
  NotificationBellEmptyTitle,
  NotificationBellError,
  NotificationBellHeader,
  NotificationBellItem,
  NotificationBellItemDescription,
  NotificationBellItemState,
  NotificationBellItemTitle,
  NotificationBellList,
  NotificationBellMenu,
  NotificationBellMore,
  NotificationBellTrigger,
} from "./notification-bell-menu";

const notificationMenuLimit = 5;

export { NotificationBellSkeleton } from "./notification-bell-menu";

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
  const locale = await getLocale(tenantId);
  const [list, unread, t] = await Promise.all([
    listNotifications(tenantId, locale, { limit: notificationMenuLimit }),
    countUnreadNotifications(tenantId, locale),
    getMessagesFor(locale),
  ]);
  const count = Math.max(0, unread.unreadCount);
  const ariaLabel =
    count > 0
      ? t("admin.shell.notifications_unread", { count })
      : t("admin.shell.notifications_none");
  let notificationContent = (
    <NotificationBellError>
      <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
        <Message message="admin.notifications.list_failed" />
      </Suspense>
    </NotificationBellError>
  );

  if (list.ok && list.notifications.length === 0) {
    notificationContent = (
      <NotificationBellEmpty>
        <NotificationBellEmptyTitle>
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="admin.notifications.empty_title" />
          </Suspense>
        </NotificationBellEmptyTitle>
        <NotificationBellEmptyDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="admin.notifications.empty_description" />
          </Suspense>
        </NotificationBellEmptyDescription>
      </NotificationBellEmpty>
    );
  }

  if (list.ok && list.notifications.length > 0) {
    notificationContent = (
      <NotificationBellList>
        {list.notifications.map((notification) => (
          <NotificationBellItem
            href={notification.href}
            isRead={notification.isRead}
            key={notification.id}
          >
            <NotificationBellItemState>
              {notification.isRead
                ? t("admin.notifications.read")
                : t("admin.notifications.unread")}
            </NotificationBellItemState>
            <NotificationBellItemTitle>
              {notification.title}
            </NotificationBellItemTitle>
            <NotificationBellItemDescription>
              {notification.description}
            </NotificationBellItemDescription>
          </NotificationBellItem>
        ))}
      </NotificationBellList>
    );
  }

  return (
    <NotificationBellMenu>
      <NotificationBellTrigger unreadCount={count}>
        {ariaLabel}
      </NotificationBellTrigger>
      <NotificationBellContent>
        <NotificationBellHeader unreadCount={count}>
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="admin.notifications.title" />
          </Suspense>
        </NotificationBellHeader>
        {notificationContent}
        <NotificationBellMore href="/notifications">
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="admin.notifications.menu_more" />
          </Suspense>
        </NotificationBellMore>
      </NotificationBellContent>
    </NotificationBellMenu>
  );
};
