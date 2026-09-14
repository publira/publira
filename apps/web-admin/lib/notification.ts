import type { AdminNotification } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
} from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheTag } from "next/cache";

import type {
  CountUnreadNotificationsResult,
  ListNotificationsResult,
  NotificationItem,
} from "../app/[tenant_id]/(protected)/notifications/notification-types";
import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import type { CursorPageOptions } from "./cursor-page";
import {
  cursorPageRequest,
  cursorPageTokens,
  emptyCursorPageTokens,
} from "./cursor-page";
import { getMessagesFor } from "./messages";
import {
  notificationDisplay,
  parseNotificationPayload,
} from "./notification-copy";
import { getAccessToken } from "./session";

export const notificationsCacheTag = (tenantId: string): string =>
  `notifications-${tenantId.trim()}`;

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

/** The generated `AdminNotification` fields {@link mapNotification} reads (see `series.ts`). */
type RawNotification = Pick<
  AdminNotification,
  "createdAt" | "id" | "isRead" | "notificationType" | "payload"
>;

const mapNotification = async (
  item: RawNotification,
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

const readNotificationList = async (
  tenantId: string,
  options: CursorPageOptions,
  locale: Locale
): Promise<CachedListNotificationsResult> => {
  "use cache: private";
  cacheTag(notificationsCacheTag(tenantId));

  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return {
      ...emptyCursorPageTokens,
      message: t("errors.rpc.unauthenticated"),
      notifications: [],
      ok: false,
      requiresSignIn: true,
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

    const notifications = await Promise.all(
      (response.notifications ?? []).map((item) =>
        mapNotification(item, locale)
      )
    );

    return {
      ...cursorPageTokens(response),
      notifications,
      ok: true,
      unexpected: false,
    };
  } catch (error) {
    dropFailedCacheEntry();
    return {
      ...emptyCursorPageTokens,
      message: mapErrorMessage(
        error,
        t("admin.notifications.list_failed"),
        locale
      ),
      notifications: [],
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
      unexpected: isUnexpectedError(error),
    };
  }
};

const readUnreadNotificationCount = async (
  tenantId: string,
  locale: Locale
): Promise<CachedUnreadCountResult> => {
  "use cache: private";
  cacheTag(notificationsCacheTag(tenantId));

  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
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
      message: mapErrorMessage(
        error,
        t("admin.notifications.count_failed"),
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
 * One page of the signed-in admin's inbox, newest first.
 *
 * The rows keep the server's keyset order (`created_at`, `id` descending).
 * Sorting them here would only sort the rows that happen to share a page.
 */
export const listNotifications = async (
  tenantId: string,
  locale: Locale,
  options: CursorPageOptions = {}
): Promise<ListNotificationsResult> => {
  const [{ unexpected, ...result }, t] = await Promise.all([
    readNotificationList(tenantId, options, locale),
    getMessagesFor(locale),
  ]);
  throwIfUnexpected(
    unexpected,
    result.ok ? t("admin.notifications.list_failed") : result.message
  );
  return result;
};

/**
 * Unread count for the header bell. A classified failure is an empty bell, not
 * a header crash — the count is chrome, and the list page is the source of
 * truth when the operator opens it.
 */
export const countUnreadNotifications = async (
  tenantId: string,
  locale: Locale
): Promise<CountUnreadNotificationsResult> => {
  const [{ unexpected, ...result }, t] = await Promise.all([
    readUnreadNotificationCount(tenantId, locale),
    getMessagesFor(locale),
  ]);
  throwIfUnexpected(
    unexpected,
    result.ok ? t("admin.notifications.count_failed") : result.message
  );
  return result;
};

export const markNotificationAsRead = async (
  input: {
    notificationId: string;
    tenantId: string;
  },
  locale: Locale
): Promise<{ message: string; ok: false } | { ok: true }> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
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
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorMessage(
        error,
        t("admin.notifications.mark_read_failed"),
        locale
      ),
      ok: false,
    };
  }
};

export const markAllNotificationsAsRead = async (
  tenantId: string,
  locale: Locale
): Promise<
  { message: string; ok: false } | { markedCount: number; ok: true }
> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
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
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorMessage(
        error,
        t("admin.notifications.mark_all_read_failed"),
        locale
      ),
      ok: false,
    };
  }
};
