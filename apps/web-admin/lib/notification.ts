import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";
import { forEachPageWithToken } from "@publira/api-client/pagination";
import { cacheTag } from "next/cache";

import type {
  ListNotificationsResult,
  ListNotificationTargetUsersResult,
  NotificationItem,
  NotificationTargetUser,
} from "../app/[tenant_id]/(protected)/notifications/notification-types";
import { apiClient, withSessionHeaders } from "./api";
import type { CursorPageOptions } from "./cursor-page";
import {
  cursorPageRequest,
  cursorPageTokens,
  emptyCursorPageTokens,
} from "./cursor-page";
import { getAccessToken } from "./session";

const sessionErrorMessage = "セッションが無効です。再ログインしてください。";
const listErrorMessage =
  "通知一覧の取得に失敗しました。時間をおいて再試行してください。";
const createErrorMessage =
  "通知の配信に失敗しました。時間をおいて再試行してください。";
const targetUsersErrorMessage = "対象ユーザー一覧の取得に失敗しました。";
const audienceTypeAllUsers = 1;
const audienceTypeSelectedUsers = 2;

const mapErrorMessage = (error: unknown, fallback: string): string =>
  rpcErrorMessage(error, fallback);

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

const mapUser = (user: {
  publicId: string;
  name: string;
}): NotificationTargetUser => ({
  name: user.name,
  publicId: user.publicId,
});

/**
 * Every user a notification can be addressed to.
 *
 * Walks `ListTenantUsers` cursor pages so the create form offers members past
 * the first page too. Sorted by name once the whole set is in hand; sorting a
 * single page would only order the rows that page happened to hold.
 *
 * Deliberately uncached: nothing in this app invalidates a tenant's member
 * list, so a cache tag here would keep a newly added member out of the picker
 * until the entry expired.
 */
export const listAllNotificationTargetUsers = async (
  tenantId: string
): Promise<ListNotificationTargetUsersResult> => {
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage,
      ok: false,
      users: [],
    };
  }

  try {
    const users: NotificationTargetUser[] = [];
    const walkStop = await forEachPageWithToken(
      async (token, limit) => {
        const response = await apiClient.users.listTenantUsers(
          {
            limit,
            query: "",
            tenant: { tenantId },
            token,
          },
          withSessionHeaders(sessionId)
        );
        return {
          items: response.users ?? [],
          nextToken: response.nextToken ?? "",
        };
      },
      (items) => {
        for (const item of items) {
          if (item.publicId.trim() !== "") {
            users.push(mapUser(item));
          }
        }
      }
    );

    // Match the series pickers: a partial walk must not surface a half-built
    // option list that operators read as the whole tenant.
    if (walkStop !== "completed") {
      return {
        message: targetUsersErrorMessage,
        ok: false,
        users: [],
      };
    }

    return {
      ok: true,
      users: users.toSorted((a, b) => a.name.localeCompare(b.name, "ja")),
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorMessage(error, targetUsersErrorMessage),
      ok: false,
      users: [],
    };
  }
};

/**
 * One page of the tenant's notifications, newest first.
 *
 * The rows keep the server's keyset order (`created_at`, `id` descending).
 * Sorting them here would only sort the rows that happen to share a page, which
 * reads as a broken order as soon as the list spans more than one page.
 */
export const listNotifications = async (
  tenantId: string,
  options: CursorPageOptions = {}
): Promise<ListNotificationsResult> => {
  "use cache: private";
  cacheTag(`notifications-${tenantId}`);

  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      ...emptyCursorPageTokens,
      message: sessionErrorMessage,
      notifications: [],
      ok: false,
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
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      ...emptyCursorPageTokens,
      message: mapErrorMessage(error, listErrorMessage),
      notifications: [],
      ok: false,
    };
  }
};

export const createNotification = async (input: {
  tenantId: string;
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
        tenant: { tenantId: input.tenantId },
        title: input.title,
      },
      withSessionHeaders(sessionId)
    );

    return {
      createdCount: response.notifications?.length ?? 0,
      ok: true,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorMessage(error, createErrorMessage),
      ok: false,
    };
  }
};
