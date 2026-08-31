import { getMessage } from "@publira/i18n";

import { getLocale, loadAdminMessages } from "#lib/locale";
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
  const [list, unread, messages] = await Promise.all([
    listNotifications(tenantId, locale, { limit: notificationMenuLimit }),
    countUnreadNotifications(tenantId, locale),
    loadAdminMessages(locale),
  ]);
  const count = Math.max(0, unread.unreadCount);
  const ariaLabel =
    count > 0
      ? getMessage(messages, "admin.shell.notifications_unread", { count })
      : getMessage(messages, "admin.shell.notifications_none");
  let notificationContent = (
    <NotificationBellError>
      {getMessage(messages, "admin.notifications.list_failed")}
    </NotificationBellError>
  );

  if (list.ok && list.notifications.length === 0) {
    notificationContent = (
      <NotificationBellEmpty>
        <NotificationBellEmptyTitle>
          {getMessage(messages, "admin.notifications.empty_title")}
        </NotificationBellEmptyTitle>
        <NotificationBellEmptyDescription>
          {getMessage(messages, "admin.notifications.empty_description")}
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
                ? getMessage(messages, "admin.notifications.read")
                : getMessage(messages, "admin.notifications.unread")}
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
          {getMessage(messages, "admin.notifications.title")}
        </NotificationBellHeader>
        {notificationContent}
        <NotificationBellMore href="/notifications">
          {getMessage(messages, "admin.notifications.menu_more")}
        </NotificationBellMore>
      </NotificationBellContent>
    </NotificationBellMenu>
  );
};
