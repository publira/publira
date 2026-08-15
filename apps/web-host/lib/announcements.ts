import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  Code,
  isRpcError,
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
} from "@publira/api-client/errors";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { z } from "zod";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import { tenantIdFormSchema } from "./auth-input";
import { applyCacheTag, tenantAnnouncementsTag } from "./cache-tags";

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

const listErrorMessage = "お知らせの取得に失敗しました。";

/**
 * Tag the cached inbox read carries, so `updateTag` in the Server Action
 * makes a mark-read visible on the next list render.
 */
export const announcementsCacheTag = tenantAnnouncementsTag;

const mapErrorToMessage = (error: unknown): string =>
  rpcErrorMessage(error, listErrorMessage, {
    "invalid-argument": "セッションが無効です。再ログインしてください。",
  });

const isUnexpectedError = (error: unknown): boolean =>
  rpcErrorDisposition(error) === "unexpected";

const throwIfUnexpected = (unexpected: boolean, message: string): void => {
  if (unexpected) {
    throw new Error(message);
  }
};

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

const emptyListPage = {
  announcements: [] as MemberAnnouncementItem[],
  nextToken: "",
  previousToken: "",
};

type CachedListMyAnnouncementsResult = ListMyAnnouncementsResult & {
  unexpected: boolean;
};

const readAnnouncementList = async (
  tenantId: string,
  sessionId: string | undefined,
  options: ListMyAnnouncementsOptions
): Promise<CachedListMyAnnouncementsResult> => {
  "use cache: private";
  applyCacheTag(announcementsCacheTag(tenantId));

  const sid = await resolveAccessToken(sessionId);
  try {
    const response = await listAnnouncementsRpc(tenantId, sid, options);

    return {
      announcements: mapAnnouncementItems(response),
      nextToken: response.nextToken ?? "",
      ok: true,
      previousToken: response.previousToken ?? "",
      unexpected: false,
    };
  } catch (error) {
    dropFailedCacheEntry();
    return {
      ...emptyListPage,
      message: mapErrorToMessage(error),
      ok: false,
      requiresSignIn: isSignInRequiredError(error),
      unexpected: isUnexpectedError(error),
    };
  }
};

export const listMyAnnouncements = async (
  tenantId: string,
  sessionId?: string,
  options: ListMyAnnouncementsOptions = {}
): Promise<ListMyAnnouncementsResult> => {
  const { unexpected, ...result } = await readAnnouncementList(
    tenantId,
    sessionId,
    options
  );
  throwIfUnexpected(unexpected, result.ok ? listErrorMessage : result.message);
  return result;
};

const getMyAnnouncementInputSchema = z.object({
  announcementId: z.string().trim().pipe(z.uuid()),
  tenantId: tenantIdFormSchema,
});

interface CachedGetMyAnnouncementResult {
  unexpected: boolean;
  value: MemberAnnouncementItem | null;
}

const readMyAnnouncement = async (
  tenantId: string,
  announcementId: string,
  sessionId?: string
): Promise<CachedGetMyAnnouncementResult> => {
  "use cache: private";

  const parsed = getMyAnnouncementInputSchema.safeParse({
    announcementId,
    tenantId,
  });
  if (!parsed.success) {
    // Same null as a missing row: a malformed id is not a distinct outcome.
    return { unexpected: false, value: null };
  }

  applyCacheTag(announcementsCacheTag(parsed.data.tenantId));

  const sid = await resolveAccessToken(sessionId);
  if (!sid) {
    return { unexpected: false, value: null };
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
      return { unexpected: false, value: null };
    }

    return {
      unexpected: false,
      value: mapAnnouncementItem(response.announcement),
    };
  } catch (error) {
    dropFailedCacheEntry();
    return {
      unexpected: isUnexpectedError(error),
      value: null,
    };
  }
};

/**
 * Session-authorized get-by-id. A form-supplied `linkUrl` is not a substitute.
 */
export const getMyAnnouncement = async (
  tenantId: string,
  announcementId: string,
  sessionId?: string
): Promise<MemberAnnouncementItem | null> => {
  const result = await readMyAnnouncement(tenantId, announcementId, sessionId);
  throwIfUnexpected(result.unexpected, listErrorMessage);
  return result.value;
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
