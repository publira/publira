import type { AdminNotification } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
} from "@publira/api-client/errors";
import { DEFAULT_LOCALE, getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
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
import {
  notificationDisplay,
  parseNotificationPayload,
} from "./notification-copy";
import { getAccessToken } from "./session";

const sessionErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "errors.rpc.unauthenticated");
const listErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "admin.notifications.list_failed");
const countErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "admin.notifications.count_failed");
const markReadErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "admin.notifications.mark_read_failed");
const markAllReadErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "admin.notifications.mark_all_read_failed");

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

const mapNotification = (
  item: RawNotification,
  messages: SharedMessages
): NotificationItem => {
  const display = notificationDisplay(
    item.notificationType,
    parseNotificationPayload(item.payload),
    messages
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

  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      ...emptyCursorPageTokens,
      message: sessionErrorMessage(messages),
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

    return {
      ...cursorPageTokens(response),
      notifications: (response.notifications ?? []).map((item) =>
        mapNotification(item, messages)
      ),
      ok: true,
      unexpected: false,
    };
  } catch (error) {
    dropFailedCacheEntry();
    return {
      ...emptyCursorPageTokens,
      message: mapErrorMessage(error, listErrorMessage(messages), locale),
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

  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage(messages),
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
      message: mapErrorMessage(error, countErrorMessage(messages), locale),
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
  options: CursorPageOptions = {},
  locale: Locale = DEFAULT_LOCALE
): Promise<ListNotificationsResult> => {
  const { unexpected, ...result } = await readNotificationList(
    tenantId,
    options,
    locale
  );
  throwIfUnexpected(
    unexpected,
    result.ok ? listErrorMessage(sharedCatalog(locale)) : result.message
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
  locale: Locale = DEFAULT_LOCALE
): Promise<CountUnreadNotificationsResult> => {
  const { unexpected, ...result } = await readUnreadNotificationCount(
    tenantId,
    locale
  );
  throwIfUnexpected(
    unexpected,
    result.ok ? countErrorMessage(sharedCatalog(locale)) : result.message
  );
  return result;
};

export const markNotificationAsRead = async (
  input: {
    notificationId: string;
    tenantId: string;
  },
  locale: Locale = DEFAULT_LOCALE
): Promise<{ message: string; ok: false } | { ok: true }> => {
  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage(messages),
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
      message: mapErrorMessage(error, markReadErrorMessage(messages), locale),
      ok: false,
    };
  }
};

export const markAllNotificationsAsRead = async (
  tenantId: string,
  locale: Locale = DEFAULT_LOCALE
): Promise<
  { message: string; ok: false } | { markedCount: number; ok: true }
> => {
  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage(messages),
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
        markAllReadErrorMessage(messages),
        locale
      ),
      ok: false,
    };
  }
};
