import type { CursorPageTokens } from "#lib/cursor-page";

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  linkUrl: string;
  audienceType: "all" | "selected";
  targetUserPublicId: string;
  targetUserName: string;
  createdAt: string;
}

export interface NotificationTargetUser {
  publicId: string;
  name: string;
}

export type ListNotificationsResult = CursorPageTokens &
  (
    | {
        ok: true;
        notifications: NotificationItem[];
      }
    | {
        ok: false;
        message: string;
        notifications: NotificationItem[];
      }
  );

/** Every user the create form can address, or the reason none could be read. */
export type ListNotificationTargetUsersResult =
  | {
      ok: true;
      users: NotificationTargetUser[];
    }
  | {
      ok: false;
      message: string;
      users: NotificationTargetUser[];
    };

export type CreateNotificationActionState =
  | {
      ok: false;
      message: string;
    }
  | {
      ok: true;
      message: string;
      createdCount: number;
    }
  | null;
