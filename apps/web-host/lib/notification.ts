import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  Code,
  isRpcError,
  isUnauthenticatedRpcError,
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
} from "@publira/api-client/errors";
import type { NotificationItem as NotificationItemMessage } from "@publira/api-client/public/types";
import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";

import type {
  CountUnreadNotificationsResult,
  ListNotificationsResult,
  NotificationItem,
} from "../app/[tenant_id]/[locale]/(site)/notifications/notification-types";
import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import { applyCacheTag, tenantNotificationsTag } from "./cache-tags";
import { loadHostMessages } from "./messages";
import type { HostMessages } from "./messages";
import {
  notificationDisplay,
  parseNotificationPayload,
} from "./notification-copy";

/**
 * `locale` reaches every read below as an argument rather than being resolved
 * inside the cached scope, so both the row copy and the failure wording belong
 * to the cache key instead of to whichever request filled the entry.
 */
const notificationMessage = async (
  locale: Locale,
  key:
    | "errors.rpc.unauthenticated"
    | "host.notifications.count_failed"
    | "host.notifications.list_failed"
    | "host.notifications.mark_all_read_failed"
    | "host.notifications.mark_read_failed"
): Promise<string> => getMessage(await loadHostMessages(locale), key);

const defaultPageSize = 20;

/**
 * Tag the cached inbox read carries, so `updateTag` in the Server Action makes
 * a mark-read visible in the same session — both on the list and on the header
 * bell.
 */
export const notificationsCacheTag = tenantNotificationsTag;

const mapErrorMessage = (
  error: unknown,
  fallback: string,
  locale: Locale
): string => rpcErrorMessage(error, fallback, { locale });

const isUnexpectedError = (error: unknown): boolean =>
  rpcErrorDisposition(error) === "unexpected";

/**
 * Only an expired or missing session sends the reader back through login.
 * `InvalidArgument` is not a session problem here: a cursor token can pass
 * the base64url shape check and still be rejected by `ListNotifications`.
 * Treating that as sign-in would bounce the same `?token=` URL after login.
 */
const isSignInRequiredError = (error: unknown): boolean =>
  isRpcError(error, Code.Unauthenticated);

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
 * The generated `NotificationItem` fields {@link mapNotification} reads. Naming
 * them against the message type is what makes a proto rename fail here — a
 * restated structural type keeps compiling, and the inbox then renders rows
 * whose copy falls back to the unknown-type wording with nothing pointing at
 * the cause.
 */
type RawNotification = Pick<
  NotificationItemMessage,
  "createdAt" | "id" | "isRead" | "notificationType" | "payload"
>;

const mapNotification = (
  item: RawNotification,
  messages: HostMessages
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
  /** UI locale the row copy and the failure wording belong to. */
  locale: Locale;
  token?: string;
}

const emptyListPage = {
  nextToken: "",
  notifications: [] as NotificationItem[],
  previousToken: "",
};

const readNotificationList = async (
  tenantId: string,
  input: ListNotificationsInput
): Promise<CachedListNotificationsResult> => {
  "use cache: private";
  applyCacheTag(notificationsCacheTag(tenantId));

  const { locale } = input;
  const [messages, sessionId] = await Promise.all([
    loadHostMessages(locale),
    resolveAccessToken(),
  ]);
  if (!sessionId) {
    return {
      ...emptyListPage,
      message: getMessage(messages, "errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: true,
      unexpected: false,
    };
  }

  try {
    const response = await apiClient.notification.listNotifications(
      {
        limit: input.limit ?? defaultPageSize,
        tenant: { tenantId },
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
      ...emptyListPage,
      message: mapErrorMessage(
        error,
        getMessage(messages, "host.notifications.list_failed"),
        locale
      ),
      ok: false,
      requiresSignIn: isSignInRequiredError(error),
      unexpected: isUnexpectedError(error),
    };
  }
};

const readUnreadNotificationCount = async (
  tenantId: string,
  locale: Locale
): Promise<CachedUnreadCountResult> => {
  "use cache: private";
  applyCacheTag(notificationsCacheTag(tenantId));

  const [messages, sessionId] = await Promise.all([
    loadHostMessages(locale),
    resolveAccessToken(),
  ]);
  if (!sessionId) {
    return {
      message: getMessage(messages, "errors.rpc.unauthenticated"),
      ok: false,
      unexpected: false,
      unreadCount: 0,
    };
  }

  try {
    const response = await apiClient.notification.countUnreadNotifications(
      { tenant: { tenantId } },
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
        getMessage(messages, "host.notifications.count_failed"),
        locale
      ),
      ok: false,
      unexpected: isUnexpectedError(error),
      unreadCount: 0,
    };
  }
};

/**
 * One page of the signed-in member's inbox, newest first.
 *
 * The rows keep the server's keyset order (`created_at`, `id` descending).
 * Sorting them here would only sort the rows that happen to share a page.
 */
export const listNotifications = async (
  tenantId: string,
  input: ListNotificationsInput
): Promise<ListNotificationsResult> => {
  const { unexpected, ...result } = await readNotificationList(tenantId, input);
  throwIfUnexpected(
    unexpected,
    result.ok
      ? await notificationMessage(
          input.locale,
          "host.notifications.list_failed"
        )
      : result.message
  );
  return result;
};

/**
 * Unread count for the header bell. A classified failure is an empty bell, not
 * a header crash — the count is chrome, and the list page is the source of
 * truth when the member opens it.
 */
export const countUnreadNotifications = async (
  tenantId: string,
  locale: Locale
): Promise<CountUnreadNotificationsResult> => {
  const { unexpected, ...result } = await readUnreadNotificationCount(
    tenantId,
    locale
  );
  throwIfUnexpected(
    unexpected,
    result.ok
      ? await notificationMessage(locale, "host.notifications.count_failed")
      : result.message
  );
  return result;
};

export const markNotificationAsRead = async (input: {
  locale: Locale;
  notificationId: string;
  tenantId: string;
}): Promise<{ message: string; ok: false } | { ok: true }> => {
  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    return {
      message: await notificationMessage(
        input.locale,
        "errors.rpc.unauthenticated"
      ),
      ok: false,
    };
  }

  try {
    await apiClient.notification.markNotificationAsRead(
      {
        notificationId: input.notificationId,
        tenant: { tenantId: input.tenantId },
      },
      buildSessionHeaders(sessionId)
    );
    return { ok: true };
  } catch (error) {
    if (isUnauthenticatedRpcError(error)) {
      throw error;
    }
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorMessage(
        error,
        await notificationMessage(
          input.locale,
          "host.notifications.mark_read_failed"
        ),
        input.locale
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
  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    return {
      message: await notificationMessage(locale, "errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  try {
    const response = await apiClient.notification.markAllNotificationsAsRead(
      { tenant: { tenantId } },
      buildSessionHeaders(sessionId)
    );
    return {
      markedCount: response.markedCount ?? 0,
      ok: true,
    };
  } catch (error) {
    if (isUnauthenticatedRpcError(error)) {
      throw error;
    }
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorMessage(
        error,
        await notificationMessage(
          locale,
          "host.notifications.mark_all_read_failed"
        ),
        locale
      ),
      ok: false,
    };
  }
};
