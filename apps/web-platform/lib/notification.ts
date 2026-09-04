import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
} from "@publira/api-client/errors";
import type { PlatformNotification } from "@publira/api-client/platform/types";
import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
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
import {
  notificationDisplay,
  parseNotificationPayload,
} from "./notification-copy";

const sessionErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "errors.rpc.unauthenticated");
const listErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "platform.notifications.list_failed");
const countErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "platform.notifications.count_failed");
const markReadErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "platform.notifications.mark_read_failed");
const markAllReadErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "platform.notifications.mark_all_read_failed");

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

const mapNotification = (
  item: RawPlatformNotification,
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

  const messages = sharedCatalog(locale);
  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    dropFailedCacheEntry();
    return {
      message: sessionErrorMessage(messages),
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

    return {
      nextToken: response.nextToken ?? "",
      notifications: (response.notifications ?? []).map((item) =>
        mapNotification(item, messages)
      ),
      ok: true,
      previousToken: response.previousToken ?? "",
      unexpected: false,
    };
  } catch (error) {
    dropFailedCacheEntry();
    return {
      message: mapErrorMessage(error, listErrorMessage(messages), locale),
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

  const messages = sharedCatalog(locale);
  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    dropFailedCacheEntry();
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
      message: mapErrorMessage(error, countErrorMessage(messages), locale),
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
  const { unexpected, ...result } = await readNotificationList(input, locale);
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
  locale: Locale
): Promise<CountUnreadNotificationsResult> => {
  const { unexpected, ...result } = await readUnreadNotificationCount(locale);
  throwIfUnexpected(
    unexpected,
    result.ok ? countErrorMessage(sharedCatalog(locale)) : result.message
  );
  return result;
};

export const markNotificationAsRead = async (
  input: {
    notificationId: string;
  },
  locale: Locale
): Promise<{ message: string; ok: false } | { ok: true }> => {
  const messages = sharedCatalog(locale);
  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage(messages),
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
      message: mapErrorMessage(error, markReadErrorMessage(messages), locale),
      ok: false,
    };
  }
};

export const markAllNotificationsAsRead = async (
  locale: Locale
): Promise<
  { message: string; ok: false } | { markedCount: number; ok: true }
> => {
  const messages = sharedCatalog(locale);
  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage(messages),
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
        markAllReadErrorMessage(messages),
        locale
      ),
      ok: false,
    };
  }
};
