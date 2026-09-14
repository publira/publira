import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
} from "@publira/api-client/errors";
import type { PlatformNotification } from "@publira/api-client/platform/types";
import type { Locale } from "@publira/i18n";
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
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./auth-shared";
import { getMessagesFor } from "./messages";
import {
  notificationDisplay,
  parseNotificationPayload,
} from "./notification-copy";

const defaultPageSize = 20;

/**
 * Tag the cached inbox read carries, so `updateTag` in the Server Action makes
 * a mark-read visible in the same session — both on the list and on the header
 * bell.
 */
export const notificationsCacheTag = "platform:notifications";

const mapErrorMessage = (
  error: unknown,
  fallback: string,
  locale: Locale
): string => rpcErrorMessage(error, fallback, { locale });

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

/**
 * The generated `PlatformNotification` fields {@link mapNotification} reads.
 * Naming them against the message type is what makes a proto rename fail here —
 * a restated structural type is a second copy of the message that goes on
 * compiling once the two drift.
 */
type RawPlatformNotification = Pick<
  PlatformNotification,
  "createdAt" | "id" | "isRead" | "notificationType" | "payload"
>;

const mapNotification = async (
  item: RawPlatformNotification,
  locale: Locale
): Promise<NotificationItem> => {
  const display = await notificationDisplay(
    item.notificationType,
    parseNotificationPayload(item.payload),
    locale
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
  input: ListNotificationsInput,
  locale: Locale
): Promise<CachedListNotificationsResult> => {
  "use cache: private";
  cacheTag(notificationsCacheTag);

  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    resolveAccessToken(),
  ]);
  if (!sessionId) {
    dropFailedCacheEntry();
    return {
      message: t("errors.rpc.unauthenticated"),
      nextToken: "",
      notifications: [],
      ok: false,
      previousToken: "",
      requiresSignIn: true,
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

    const notifications = await Promise.all(
      (response.notifications ?? []).map((item) =>
        mapNotification(item, locale)
      )
    );

    return {
      nextToken: response.nextToken ?? "",
      notifications,
      ok: true,
      previousToken: response.previousToken ?? "",
      unexpected: false,
    };
  } catch (error) {
    dropFailedCacheEntry();
    return {
      message: mapErrorMessage(
        error,
        t("platform.notifications.list_failed"),
        locale
      ),
      nextToken: "",
      notifications: [],
      ok: false,
      previousToken: "",
      requiresSignIn: isUnauthenticatedError(error),
      unexpected: isUnexpectedError(error),
    };
  }
};

const readUnreadNotificationCount = async (
  locale: Locale
): Promise<CachedUnreadCountResult> => {
  "use cache: private";
  cacheTag(notificationsCacheTag);

  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    resolveAccessToken(),
  ]);
  if (!sessionId) {
    dropFailedCacheEntry();
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: true,
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
      message: mapErrorMessage(
        error,
        t("platform.notifications.count_failed"),
        locale
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
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
  locale: Locale,
  input: ListNotificationsInput = {}
): Promise<ListNotificationsResult> => {
  const [{ unexpected, ...result }, t] = await Promise.all([
    readNotificationList(input, locale),
    getMessagesFor(locale),
  ]);
  throwIfUnexpected(
    unexpected,
    result.ok ? t("platform.notifications.list_failed") : result.message
  );
  return result;
};

/**
 * Unread count for the header bell. A classified failure is an empty bell, not
 * a header crash — the count is chrome, and the list page is the source of
 * truth when the operator opens it.
 */
export const countUnreadNotifications = async (
  locale: Locale
): Promise<CountUnreadNotificationsResult> => {
  const [{ unexpected, ...result }, t] = await Promise.all([
    readUnreadNotificationCount(locale),
    getMessagesFor(locale),
  ]);
  throwIfUnexpected(
    unexpected,
    result.ok ? t("platform.notifications.count_failed") : result.message
  );
  return result;
};

export const markNotificationAsRead = async (
  input: {
    notificationId: string;
  },
  locale: Locale
): Promise<{ message: string; ok: false } | { ok: true }> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    resolveAccessToken(),
  ]);
  if (!sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
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
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorMessage(
        error,
        t("platform.notifications.mark_read_failed"),
        locale
      ),
      ok: false,
    };
  }
};

export const markAllNotificationsAsRead = async (
  locale: Locale
): Promise<
  { message: string; ok: false } | { markedCount: number; ok: true }
> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    resolveAccessToken(),
  ]);
  if (!sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
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
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorMessage(
        error,
        t("platform.notifications.mark_all_read_failed"),
        locale
      ),
      ok: false,
    };
  }
};
