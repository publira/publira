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

export type ListNotificationsResult =
  | {
      ok: true;
      notifications: NotificationItem[];
      users: NotificationTargetUser[];
      usersErrorMessage?: string;
    }
  | {
      ok: false;
      message: string;
      notifications: NotificationItem[];
      users: NotificationTargetUser[];
      usersErrorMessage?: string;
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
