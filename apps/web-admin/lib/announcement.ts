import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";
import { forEachPageWithToken } from "@publira/api-client/pagination";
import { cacheTag } from "next/cache";

import type {
  ListAnnouncementsResult,
  ListAnnouncementTargetUsersResult,
  AnnouncementItem,
  AnnouncementTargetUser,
} from "../app/[tenant_id]/(protected)/announcements/announcement-types";
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
  "お知らせ一覧の取得に失敗しました。時間をおいて再試行してください。";
const createErrorMessage =
  "お知らせの配信に失敗しました。時間をおいて再試行してください。";
const targetUsersErrorMessage = "対象ユーザー一覧の取得に失敗しました。";
const audienceTypeAllUsers = 1;
const audienceTypeSelectedUsers = 2;

const mapErrorMessage = (error: unknown, fallback: string): string =>
  rpcErrorMessage(error, fallback);

const mapAnnouncement = (item: {
  audienceType: number;
  body: string;
  createdAt: string;
  id: string;
  linkUrl: string;
  targetUserName: string;
  targetUserPublicId: string;
  title: string;
}): AnnouncementItem => ({
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
}): AnnouncementTargetUser => ({
  name: user.name,
  publicId: user.publicId,
});

/**
 * Every user an announcement can be addressed to.
 *
 * Walks `ListTenantUsers` cursor pages so the create form offers members past
 * the first page too. Sorted by name once the whole set is in hand; sorting a
 * single page would only order the rows that page happened to hold.
 *
 * Deliberately uncached: nothing in this app invalidates a tenant's member
 * list, so a cache tag here would keep a newly added member out of the picker
 * until the entry expired.
 */
export const listAllAnnouncementTargetUsers = async (
  tenantId: string
): Promise<ListAnnouncementTargetUsersResult> => {
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage,
      ok: false,
      users: [],
    };
  }

  try {
    const users: AnnouncementTargetUser[] = [];
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
 * One page of the tenant's announcements, newest first.
 *
 * The rows keep the server's keyset order (`created_at`, `id` descending).
 * Sorting them here would only sort the rows that happen to share a page, which
 * reads as a broken order as soon as the list spans more than one page.
 */
export const listAnnouncements = async (
  tenantId: string,
  options: CursorPageOptions = {}
): Promise<ListAnnouncementsResult> => {
  "use cache: private";
  cacheTag(`announcements-${tenantId}`);

  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      ...emptyCursorPageTokens,
      announcements: [],
      message: sessionErrorMessage,
      ok: false,
    };
  }

  try {
    const response = await apiClient.announcement.listAnnouncements(
      {
        ...cursorPageRequest(options),
        tenant: { tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      ...cursorPageTokens(response),
      announcements: (response.announcements ?? []).map((item) =>
        mapAnnouncement(item)
      ),
      ok: true,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      ...emptyCursorPageTokens,
      announcements: [],
      message: mapErrorMessage(error, listErrorMessage),
      ok: false,
    };
  }
};

export const createAnnouncement = async (input: {
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
    const response = await apiClient.announcement.createAnnouncement(
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
      createdCount: response.announcements?.length ?? 0,
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
