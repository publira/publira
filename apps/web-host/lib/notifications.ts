import { unstable_noStore as noStore } from "next/cache";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";

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
  if (
    message.includes("unauthenticated") ||
    message.includes("invalid_argument")
  ) {
    return "セッションが無効です。再ログインしてください。";
  }

  return "通知の取得に失敗しました。";
};

const mapNotificationItems = (
  response: Awaited<ReturnType<typeof apiClient.auth.listNotifications>>
): MemberNotificationItem[] =>
  (response.notifications ?? []).map((item) => ({
    body: item.body,
    createdAt: item.createdAt,
    id: item.id,
    isRead: item.isRead,
    linkUrl: item.linkUrl,
    title: item.title,
  }));

const listNotificationsRpc = (
  tenantPublicId: string,
  sessionId: string
): Promise<Awaited<ReturnType<typeof apiClient.auth.listNotifications>>> =>
  apiClient.auth.listNotifications(
    {
      limit: 100,
      offset: 0,
      tenant: { tenantPublicId },
    },
    buildSessionHeaders(sessionId)
  );

const fetchNotifications = async (
  tenantPublicId: string,
  sessionId: string
): Promise<
  | { ok: true; notifications: MemberNotificationItem[] }
  | { ok: false; message: string; notifications: MemberNotificationItem[] }
> => {
  try {
    console.info("[web-host] listNotifications request", {
      hasSessionId: sessionId.length > 0,
      sessionIdLength: sessionId.length,
      tenantPublicId,
    });

    const response = await listNotificationsRpc(tenantPublicId, sessionId);

    return {
      notifications: mapNotificationItems(response),
      ok: true,
    };
  } catch (error) {
    console.warn("[web-host] listNotifications failed", {
      error: error instanceof Error ? error.message : String(error),
      hasSessionId: sessionId.length > 0,
      sessionIdLength: sessionId.length,
      tenantPublicId,
    });

    return {
      message: mapErrorToMessage(error),
      notifications: [],
      ok: false,
    };
  }
};

export const listMyNotifications = async (
  tenantPublicId: string,
  sessionId?: string
): Promise<
  | { ok: true; notifications: MemberNotificationItem[] }
  | { ok: false; message: string; notifications: MemberNotificationItem[] }
> => {
  noStore();

  const sid = await resolveAccessToken(sessionId);
  return fetchNotifications(tenantPublicId, sid);
};

export const markNotificationAsRead = async (
  tenantPublicId: string,
  notificationId: string,
  sessionId?: string
): Promise<boolean> => {
  const sid = await resolveAccessToken(sessionId);
  if (!sid) {
    return false;
  }

  try {
    const response = await apiClient.auth.markNotificationAsRead(
      {
        notificationId,
        tenant: { tenantPublicId },
      },
      buildSessionHeaders(sid)
    );

    return Boolean(response.marked);
  } catch {
    return false;
  }
};

export const markAllNotificationsAsRead = async (
  tenantPublicId: string,
  sessionId?: string
): Promise<number> => {
  const sid = await resolveAccessToken(sessionId);
  if (!sid) {
    return 0;
  }

  try {
    const response = await apiClient.auth.markAllNotificationsAsRead(
      {
        tenant: { tenantPublicId },
      },
      buildSessionHeaders(sid)
    );

    return response.markedCount;
  } catch {
    return 0;
  }
};
