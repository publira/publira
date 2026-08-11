import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  Code,
  isRpcError,
  rethrowUnclassifiedRpcError,
} from "@publira/api-client/errors";
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

/**
 * The only argument this call carries besides paging is the session header, so
 * a rejected one is a session problem rather than bad form input. The caller
 * sends the reader back through login on this.
 */
const isSignInRequiredError = (error: unknown): boolean =>
  isRpcError(error, Code.Unauthenticated, Code.InvalidArgument);

const mapErrorToMessage = (error: unknown): string =>
  rpcErrorMessage(error, "通知の取得に失敗しました。", {
    "invalid-argument": "セッションが無効です。再ログインしてください。",
  });

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

/**
 * Cursor pagination: `token` is whatever the previous response returned as
 * `previousToken` / `nextToken`, and is opaque to the caller. Contract:
 * `proto/README.md`.
 */
export interface ListMyNotificationsOptions {
  limit?: number;
  token?: string;
}

const listNotificationsRpc = (
  tenantId: string,
  sessionId: string,
  { limit = 20, token = "" }: ListMyNotificationsOptions
): Promise<Awaited<ReturnType<typeof apiClient.auth.listNotifications>>> =>
  apiClient.auth.listNotifications(
    {
      limit,
      tenant: { tenantId },
      token,
    },
    buildSessionHeaders(sessionId)
  );

interface MyNotificationsPage {
  notifications: MemberNotificationItem[];
  /** Token for the previous page. Empty on the first page. */
  previousToken: string;
  /** Token for the next page. Empty on the last page. */
  nextToken: string;
}

export type ListMyNotificationsResult =
  | ({ ok: true } & MyNotificationsPage)
  | ({
      ok: false;
      message: string;
      /** The reader has to sign in again before this list can be shown. */
      requiresSignIn: boolean;
    } & MyNotificationsPage);

const fetchNotifications = async (
  tenantId: string,
  sessionId: string,
  options: ListMyNotificationsOptions
): Promise<ListMyNotificationsResult> => {
  try {
    const response = await listNotificationsRpc(tenantId, sessionId, options);

    return {
      nextToken: response.nextToken ?? "",
      notifications: mapNotificationItems(response),
      ok: true,
      previousToken: response.previousToken ?? "",
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    console.warn("[web-host] listNotifications failed", {
      error: error instanceof Error ? error.message : String(error),
      hasSessionId: sessionId.length > 0,
      sessionIdLength: sessionId.length,
      tenantId,
    });

    return {
      message: mapErrorToMessage(error),
      nextToken: "",
      notifications: [],
      ok: false,
      previousToken: "",
      requiresSignIn: isSignInRequiredError(error),
    };
  }
};

export const listMyNotifications = async (
  tenantId: string,
  sessionId?: string,
  options: ListMyNotificationsOptions = {}
): Promise<ListMyNotificationsResult> => {
  noStore();

  const sid = await resolveAccessToken(sessionId);
  return fetchNotifications(tenantId, sid, options);
};

export const markNotificationAsRead = async (
  tenantId: string,
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
        tenant: { tenantId },
      },
      buildSessionHeaders(sid)
    );

    return Boolean(response.marked);
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return false;
  }
};

export const markAllNotificationsAsRead = async (
  tenantId: string,
  sessionId?: string
): Promise<number> => {
  const sid = await resolveAccessToken(sessionId);
  if (!sid) {
    return 0;
  }

  try {
    const response = await apiClient.auth.markAllNotificationsAsRead(
      {
        tenant: { tenantId },
      },
      buildSessionHeaders(sid)
    );

    return response.markedCount;
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return 0;
  }
};
