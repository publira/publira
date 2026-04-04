import { cacheTag } from "next/cache";

import { apiClient, buildSessionHeaders, resolveSessionId } from "./api-client";

export interface MemberNotificationItem {
  id: string;
  title: string;
  body: string;
  linkUrl: string;
  isRead: boolean;
  createdAt: string;
}

const mapErrorToMessage = (error: unknown): string => {
  if (!(error instanceof Error)) {
    return "通知の取得に失敗しました。";
  }

  const message = error.message.toLowerCase();
  if (message.includes("unauthenticated")) {
    return "セッションが無効です。再ログインしてください。";
  }

  return "通知の取得に失敗しました。";
};

export const listMyNotifications = async (
  tenantPublicId: string
): Promise<
  | { ok: true; notifications: MemberNotificationItem[] }
  | { ok: false; message: string; notifications: MemberNotificationItem[] }
> => {
  "use cache: private";
  cacheTag(`member-notifications-${tenantPublicId}`);

  const sessionId = await resolveSessionId();
  if (!sessionId) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      notifications: [],
      ok: false,
    };
  }

  try {
    const response = await apiClient.auth.listNotifications(
      {
        limit: 100,
        offset: 0,
        sessionId,
        tenant: { tenantPublicId },
      },
      buildSessionHeaders(sessionId)
    );

    return {
      notifications: (response.notifications ?? []).map((item) => ({
        body: item.body,
        createdAt: item.createdAt,
        id: item.id,
        isRead: item.isRead,
        linkUrl: item.linkUrl,
        title: item.title,
      })),
      ok: true,
    };
  } catch (error) {
    return {
      message: mapErrorToMessage(error),
      notifications: [],
      ok: false,
    };
  }
};
