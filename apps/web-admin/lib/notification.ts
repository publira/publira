import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
} from "@publira/api-client/errors";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheTag } from "next/cache";

import type {
  CountUnreadNotificationsResult,
  ListNotificationsResult,
  NotificationItem,
} from "../app/[tenant_id]/(protected)/notifications/notification-types";
import { apiClient, withSessionHeaders } from "./api";
import type { CursorPageOptions } from "./cursor-page";
import {
  cursorPageRequest,
  cursorPageTokens,
  emptyCursorPageTokens,
} from "./cursor-page";
import {
  notificationDisplay,
  parseNotificationPayload,
} from "./notification-copy";
import { getAccessToken } from "./session";

const sessionErrorMessage = "セッションが無効です。再ログインしてください。";
const listErrorMessage =
  "通知一覧の取得に失敗しました。時間をおいて再試行してください。";
const countErrorMessage =
  "未読件数の取得に失敗しました。時間をおいて再試行してください。";
const markReadErrorMessage =
  "既読への更新に失敗しました。時間をおいて再試行してください。";
const markAllReadErrorMessage =
  "一括既読に失敗しました。時間をおいて再試行してください。";

export const notificationsCacheTag = (tenantId: string): string =>
  `notifications-${tenantId.trim()}`;

const mapErrorMessage = (error: unknown, fallback: string): string =>
  rpcErrorMessage(error, fallback);

const isUnexpectedError = (error: unknown): boolean =>
  rpcErrorDisposition(error) === "unexpected";

/**
 * A `"use cache"` fill must not throw. Classify inside the cache scope, return
 * the failure as a value, then throw here so an unexpected error still reaches
 * the boundary with the fill already committed.
 */
const throwIfUnexpected = (unexpected: boolean, message: string): void => {
  if (unexpected) {
    throw new Error(message);
  }
};

const mapNotification = (item: {
  createdAt: string;
  id: string;
  isRead: boolean;
  notificationType: string;
  payload: string;
}): NotificationItem => {
  const display = notificationDisplay(
    item.notificationType,
    parseNotificationPayload(item.payload)
  );

  return {
    createdAt: item.createdAt,
    description: display.description,
    href: display.href,
    id: item.id,
    isRead: item.isRead,
    notificationType: item.notificationType,
    title: display.title,
  };
};

type CachedListNotificationsResult = ListNotificationsResult & {
  unexpected: boolean;
};

type CachedUnreadCountResult = CountUnreadNotificationsResult & {
  unexpected: boolean;
};

const readNotificationList = async (
  tenantId: string,
  options: CursorPageOptions = {}
): Promise<CachedListNotificationsResult> => {
  "use cache: private";
  cacheTag(notificationsCacheTag(tenantId));

  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      ...emptyCursorPageTokens,
      message: sessionErrorMessage,
      notifications: [],
      ok: false,
      unexpected: false,
    };
  }

  try {
    const response = await apiClient.notification.listNotifications(
      {
        ...cursorPageRequest(options),
        tenant: { tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      ...cursorPageTokens(response),
      notifications: (response.notifications ?? []).map((item) =>
        mapNotification(item)
      ),
      ok: true,
      unexpected: false,
    };
  } catch (error) {
    dropFailedCacheEntry();
    return {
      ...emptyCursorPageTokens,
      message: mapErrorMessage(error, listErrorMessage),
      notifications: [],
      ok: false,
      unexpected: isUnexpectedError(error),
    };
  }
};

const readUnreadNotificationCount = async (
  tenantId: string
): Promise<CachedUnreadCountResult> => {
  "use cache: private";
  cacheTag(notificationsCacheTag(tenantId));

  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage,
      ok: false,
      unexpected: false,
      unreadCount: 0,
    };
  }

  try {
    const response = await apiClient.notification.countUnreadNotifications(
      { tenant: { tenantId } },
      withSessionHeaders(sessionId)
    );

    return {
      ok: true,
      unexpected: false,
      unreadCount: response.unreadCount ?? 0,
    };
  } catch (error) {
    dropFailedCacheEntry();
    return {
      message: mapErrorMessage(error, countErrorMessage),
      ok: false,
      unexpected: isUnexpectedError(error),
      unreadCount: 0,
    };
  }
};

/**
 * One page of the signed-in admin's inbox, newest first.
 *
 * The rows keep the server's keyset order (`created_at`, `id` descending).
 * Sorting them here would only sort the rows that happen to share a page.
 */
export const listNotifications = async (
  tenantId: string,
  options: CursorPageOptions = {}
): Promise<ListNotificationsResult> => {
  const { unexpected, ...result } = await readNotificationList(
    tenantId,
    options
  );
  throwIfUnexpected(unexpected, result.ok ? listErrorMessage : result.message);
  return result;
};

/**
 * Unread count for the header bell. A classified failure is an empty bell, not
 * a header crash — the count is chrome, and the list page is the source of
 * truth when the operator opens it.
 */
export const countUnreadNotifications = async (
  tenantId: string
): Promise<CountUnreadNotificationsResult> => {
  const { unexpected, ...result } = await readUnreadNotificationCount(tenantId);
  throwIfUnexpected(unexpected, result.ok ? countErrorMessage : result.message);
  return result;
};

export const markNotificationAsRead = async (input: {
  notificationId: string;
  tenantId: string;
}): Promise<{ message: string; ok: false } | { ok: true }> => {
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage,
      ok: false,
    };
  }

  try {
    await apiClient.notification.markNotificationAsRead(
      {
        notificationId: input.notificationId,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );
    return { ok: true };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorMessage(error, markReadErrorMessage),
      ok: false,
    };
  }
};

export const markAllNotificationsAsRead = async (
  tenantId: string
): Promise<
  { message: string; ok: false } | { markedCount: number; ok: true }
> => {
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage,
      ok: false,
    };
  }

  try {
    const response = await apiClient.notification.markAllNotificationsAsRead(
      { tenant: { tenantId } },
      withSessionHeaders(sessionId)
    );
    return {
      markedCount: response.markedCount ?? 0,
      ok: true,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorMessage(error, markAllReadErrorMessage),
      ok: false,
    };
  }
};
