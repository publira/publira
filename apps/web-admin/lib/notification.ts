import { cacheTag } from "next/cache";

import type {
  ListNotificationsResult,
  NotificationItem,
  NotificationTargetUser,
} from "../app/[tenant_public_id]/(protected)/notifications/notification-types";
import { apiClient, withSessionHeaders } from "./api";
import { getAccessToken } from "./session";

const sessionErrorMessage = "セッションが無効です。再ログインしてください。";
const listErrorMessage =
  "通知一覧の取得に失敗しました。時間をおいて再試行してください。";
const createErrorMessage =
  "通知の配信に失敗しました。時間をおいて再試行してください。";
const audienceTypeAllUsers = 1;
const audienceTypeSelectedUsers = 2;

const mapErrorMessage = (error: unknown, fallback: string): string => {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const message = error.message.toLowerCase();
  if (message.includes("permission_denied")) {
    return "この操作を行う権限がありません。";
  }
  if (message.includes("unauthenticated")) {
    return sessionErrorMessage;
  }
  if (message.includes("invalid_argument")) {
    return "入力内容に誤りがあります。";
  }

  return fallback;
};

const mapNotification = (item: {
  audienceType: number;
  body: string;
  createdAt: string;
  id: string;
  linkUrl: string;
  targetUserName: string;
  targetUserPublicId: string;
  title: string;
}): NotificationItem => ({
  audienceType:
    item.audienceType === audienceTypeSelectedUsers ? "selected" : "all",
  body: item.body,
  createdAt: item.createdAt,
  id: item.id,
  linkUrl: item.linkUrl,
  targetUserName: item.targetUserName,
  targetUserPublicId: item.targetUserPublicId,
  title: item.title,
});

const mapUsers = (
  users: { publicId: string; name: string }[]
): NotificationTargetUser[] =>
  users
    .filter((user) => user.publicId.trim() !== "")
    .map((user) => ({
      name: user.name,
      publicId: user.publicId,
    }))
    .toSorted((a, b) => a.name.localeCompare(b.name, "ja"));

export const listNotifications = async (
  tenantPublicId: string
): Promise<ListNotificationsResult> => {
  "use cache: private";
  cacheTag(`notifications-${tenantPublicId}`);

  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage,
      notifications: [],
      ok: false,
      users: [],
    };
  }

  let users: NotificationTargetUser[] = [];
  let usersErrorMessage: string | undefined;

  try {
    const usersResponse = await apiClient.users.listTenantUsers(
      {
        limit: 200,
        query: "",
        tenant: { tenantPublicId },
      },
      withSessionHeaders(sessionId)
    );
    users = mapUsers(usersResponse.users ?? []);
  } catch (error) {
    usersErrorMessage = mapErrorMessage(
      error,
      "対象ユーザー一覧の取得に失敗しました。"
    );
  }

  try {
    const response = await apiClient.notification.listNotifications(
      {
        limit: 100,
        offset: 0,
        tenant: { tenantPublicId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      notifications: (response.notifications ?? []).map((item) =>
        mapNotification(item)
      ),
      ok: true,
      users,
      usersErrorMessage,
    };
  } catch (error) {
    return {
      message: mapErrorMessage(error, listErrorMessage),
      notifications: [],
      ok: false,
      users,
      usersErrorMessage,
    };
  }
};

export const createNotification = async (input: {
  tenantPublicId: string;
  title: string;
  body: string;
  linkUrl: string;
  audienceType: "all" | "selected";
  targetUserPublicIds: string[];
}): Promise<
  { ok: true; createdCount: number } | { ok: false; message: string }
> => {
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage,
      ok: false,
    };
  }

  const audienceTypeEnum =
    input.audienceType === "selected"
      ? audienceTypeSelectedUsers
      : audienceTypeAllUsers;

  try {
    const response = await apiClient.notification.createNotification(
      {
        audienceType: audienceTypeEnum,
        body: input.body,
        linkUrl: input.linkUrl,
        targetUserPublicIds: input.targetUserPublicIds,
        tenant: { tenantPublicId: input.tenantPublicId },
        title: input.title,
      },
      withSessionHeaders(sessionId)
    );

    return {
      createdCount: response.notifications?.length ?? 0,
      ok: true,
    };
  } catch (error) {
    return {
      message: mapErrorMessage(error, createErrorMessage),
      ok: false,
    };
  }
};
