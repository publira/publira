import type { CursorPageTokens } from "#lib/cursor-page";

export interface NotificationItem {
  createdAt: string;
  description: string;
  href?: string;
  id: string;
  isRead: boolean;
  notificationType: string;
  title: string;
}

export type ListNotificationsResult = CursorPageTokens &
  (
    | {
        notifications: NotificationItem[];
        ok: true;
      }
    | {
        message: string;
        notifications: NotificationItem[];
        ok: false;
        /** The API rejected the session — the page raises the login redirect. */
        requiresSignIn: boolean;
      }
  );

export type CountUnreadNotificationsResult =
  | { ok: true; unreadCount: number }
  | {
      message: string;
      ok: false;
      /** The API rejected the session — the header bell stays quiet about it. */
      requiresSignIn: boolean;
      unreadCount: number;
    };

/**
 * Success carries no message: the mark-as-read control unmounts once the item
 * (or the unread set) is read, so copy returned here would never reach the
 * screen.
 */
export type MarkNotificationActionState =
  | { message: string; ok: false }
  | { ok: true }
  | null;
