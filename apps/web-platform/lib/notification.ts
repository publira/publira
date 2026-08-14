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
} from "../app/(protected)/notifications/notification-types";
import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import {
  notificationDisplay,
  parseNotificationPayload,
} from "./notification-copy";

const sessionErrorMessage = "セッションが無効です。再ログインしてください。";
const listErrorMessage =
  "通知一覧の取得に失敗しました。時間をおいて再試行してください。";
const countErrorMessage =
  "未読件数の取得に失敗しました。時間をおいて再試行してください。";
const markReadErrorMessage =
  "既読への更新に失敗しました。時間をおいて再試行してください。";
const markAllReadErrorMessage =
  "一括既読に失敗しました。時間をおいて再試行してください。";

const defaultPageSize = 20;

/**
 * Tag the cached inbox read carries, so `updateTag` in the Server Action makes
 * a mark-read visible in the same session — both on the list and on the header
 * bell.
 */
export const notificationsCacheTag = "platform:notifications";

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

export interface ListNotificationsInput {
  limit?: number;
  token?: string;
}

const readNotificationList = async (
  input: ListNotificationsInput = {}
): Promise<CachedListNotificationsResult> => {
  "use cache: private";
  cacheTag(notificationsCacheTag);

  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage,
      nextToken: "",
      notifications: [],
      ok: false,
      previousToken: "",
      unexpected: false,
    };
  }

  try {
    const response = await apiClient.notification.listNotifications(
      {
        limit: input.limit ?? defaultPageSize,
        token: input.token ?? "",
      },
      buildSessionHeaders(sessionId)
    );

    return {
      nextToken: response.nextToken ?? "",
      notifications: (response.notifications ?? []).map((item) =>
        mapNotification(item)
      ),
      ok: true,
      previousToken: response.previousToken ?? "",
      unexpected: false,
    };
  } catch (error) {
    dropFailedCacheEntry();
    return {
      message: mapErrorMessage(error, listErrorMessage),
      nextToken: "",
      notifications: [],
      ok: false,
      previousToken: "",
      unexpected: isUnexpectedError(error),
    };
  }
};

const readUnreadNotificationCount =
  async (): Promise<CachedUnreadCountResult> => {
    "use cache: private";
    cacheTag(notificationsCacheTag);

    const sessionId = await resolveAccessToken();
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
        {},
        buildSessionHeaders(sessionId)
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
 * One page of the signed-in operator's inbox, newest first.
 *
 * The rows keep the server's keyset order (`created_at`, `id` descending).
 * Sorting them here would only sort the rows that happen to share a page.
 */
export const listNotifications = async (
  input: ListNotificationsInput = {}
): Promise<ListNotificationsResult> => {
  const { unexpected, ...result } = await readNotificationList(input);
  throwIfUnexpected(unexpected, result.ok ? listErrorMessage : result.message);
  return result;
};

/**
 * Unread count for the header bell. A classified failure is an empty bell, not
 * a header crash — the count is chrome, and the list page is the source of
 * truth when the operator opens it.
 */
export const countUnreadNotifications =
  async (): Promise<CountUnreadNotificationsResult> => {
    const { unexpected, ...result } = await readUnreadNotificationCount();
    throwIfUnexpected(
      unexpected,
      result.ok ? countErrorMessage : result.message
    );
    return result;
  };

export const markNotificationAsRead = async (input: {
  notificationId: string;
}): Promise<{ message: string; ok: false } | { ok: true }> => {
  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage,
      ok: false,
    };
  }

  try {
    await apiClient.notification.markNotificationAsRead(
      { notificationId: input.notificationId },
      buildSessionHeaders(sessionId)
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

export const markAllNotificationsAsRead = async (): Promise<
  { message: string; ok: false } | { markedCount: number; ok: true }
> => {
  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage,
      ok: false,
    };
  }

  try {
    const response = await apiClient.notification.markAllNotificationsAsRead(
      {},
      buildSessionHeaders(sessionId)
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
