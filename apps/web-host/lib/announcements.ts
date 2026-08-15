import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  Code,
  isRpcError,
  rethrowUnclassifiedRpcError,
} from "@publira/api-client/errors";
import { unstable_noStore as noStore } from "next/cache";
import { z } from "zod";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import { tenantIdFormSchema } from "./auth-input";

export interface MemberAnnouncementItem {
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
  rpcErrorMessage(error, "お知らせの取得に失敗しました。", {
    "invalid-argument": "セッションが無効です。再ログインしてください。",
  });

const mapAnnouncementItem = (item: {
  body: string;
  createdAt: string;
  id: string;
  isRead: boolean;
  linkUrl: string;
  title: string;
}): MemberAnnouncementItem => ({
  body: item.body,
  createdAt: item.createdAt,
  id: item.id,
  isRead: item.isRead,
  linkUrl: item.linkUrl,
  title: item.title,
});

const mapAnnouncementItems = (
  response: Awaited<ReturnType<typeof apiClient.auth.listAnnouncements>>
): MemberAnnouncementItem[] =>
  (response.announcements ?? []).map((item) => mapAnnouncementItem(item));

/**
 * Cursor pagination: `token` is whatever the previous response returned as
 * `previousToken` / `nextToken`, and is opaque to the caller. Contract:
 * `proto/README.md`.
 */
export interface ListMyAnnouncementsOptions {
  limit?: number;
  token?: string;
}

const listAnnouncementsRpc = (
  tenantId: string,
  sessionId: string,
  { limit = 20, token = "" }: ListMyAnnouncementsOptions
): Promise<Awaited<ReturnType<typeof apiClient.auth.listAnnouncements>>> =>
  apiClient.auth.listAnnouncements(
    {
      limit,
      tenant: { tenantId },
      token,
    },
    buildSessionHeaders(sessionId)
  );

interface MyAnnouncementsPage {
  announcements: MemberAnnouncementItem[];
  /** Token for the previous page. Empty on the first page. */
  previousToken: string;
  /** Token for the next page. Empty on the last page. */
  nextToken: string;
}

export type ListMyAnnouncementsResult =
  | ({ ok: true } & MyAnnouncementsPage)
  | ({
      ok: false;
      message: string;
      /** The reader has to sign in again before this list can be shown. */
      requiresSignIn: boolean;
    } & MyAnnouncementsPage);

const fetchAnnouncements = async (
  tenantId: string,
  sessionId: string,
  options: ListMyAnnouncementsOptions
): Promise<ListMyAnnouncementsResult> => {
  try {
    const response = await listAnnouncementsRpc(tenantId, sessionId, options);

    return {
      announcements: mapAnnouncementItems(response),
      nextToken: response.nextToken ?? "",
      ok: true,
      previousToken: response.previousToken ?? "",
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    console.warn("[web-host] listAnnouncements failed", {
      error: error instanceof Error ? error.message : String(error),
      hasSessionId: sessionId.length > 0,
      sessionIdLength: sessionId.length,
      tenantId,
    });

    return {
      announcements: [],
      message: mapErrorToMessage(error),
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: isSignInRequiredError(error),
    };
  }
};

export const listMyAnnouncements = async (
  tenantId: string,
  sessionId?: string,
  options: ListMyAnnouncementsOptions = {}
): Promise<ListMyAnnouncementsResult> => {
  noStore();

  const sid = await resolveAccessToken(sessionId);
  return fetchAnnouncements(tenantId, sid, options);
};

const getMyAnnouncementInputSchema = z.object({
  announcementId: z.string().trim().pipe(z.uuid()),
  tenantId: tenantIdFormSchema,
});

/**
 * Session-authorized get-by-id. A form-supplied `linkUrl` is not a substitute.
 */
export const getMyAnnouncement = async (
  tenantId: string,
  announcementId: string,
  sessionId?: string
): Promise<MemberAnnouncementItem | null> => {
  noStore();

  const parsed = getMyAnnouncementInputSchema.safeParse({
    announcementId,
    tenantId,
  });
  if (!parsed.success) {
    // Same null as a missing row: a malformed id is not a distinct outcome.
    return null;
  }

  const sid = await resolveAccessToken(sessionId);
  if (!sid) {
    return null;
  }

  try {
    const response = await apiClient.auth.getAnnouncement(
      {
        announcementId: parsed.data.announcementId,
        tenant: { tenantId: parsed.data.tenantId },
      },
      buildSessionHeaders(sid)
    );
    if (!response.announcement) {
      return null;
    }

    return mapAnnouncementItem(response.announcement);
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return null;
  }
};

export const markAnnouncementAsRead = async (
  tenantId: string,
  announcementId: string,
  sessionId?: string
): Promise<boolean> => {
  const sid = await resolveAccessToken(sessionId);
  if (!sid) {
    return false;
  }

  try {
    const response = await apiClient.auth.markAnnouncementAsRead(
      {
        announcementId,
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

export const markAllAnnouncementsAsRead = async (
  tenantId: string,
  sessionId?: string
): Promise<number> => {
  const sid = await resolveAccessToken(sessionId);
  if (!sid) {
    return 0;
  }

  try {
    const response = await apiClient.auth.markAllAnnouncementsAsRead(
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
