export interface NotificationItem {
  createdAt: string;
  description: string;
  href?: string;
  id: string;
  isRead: boolean;
  notificationType: string;
  title: string;
}

export type ListNotificationsResult =
  | {
      nextToken: string;
      notifications: NotificationItem[];
      ok: true;
      previousToken: string;
    }
  | {
      message: string;
      nextToken: string;
      notifications: NotificationItem[];
      ok: false;
      previousToken: string;
      requiresSignIn: boolean;
    };

export type CountUnreadNotificationsResult =
  | { ok: true; unreadCount: number }
  | { message: string; ok: false; unreadCount: number };

/**
 * Success carries no message: the mark-as-read control unmounts once the item
 * (or the unread set) is read, so copy returned here would never reach the
 * screen.
 */
export type MarkNotificationActionState =
  | { message: string; ok: false }
  | { ok: true }
  | null;
