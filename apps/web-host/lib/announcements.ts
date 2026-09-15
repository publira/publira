import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  isUnauthenticatedRpcError,
  rethrowUnclassifiedRpcError,
} from "@publira/api-client/errors";
import type { AnnouncementItem } from "@publira/api-client/public/types";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { z } from "zod";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import { tenantIdSchema } from "./auth-input";
import {
  applyCacheTag,
  tenantAnnouncementsTag,
  tenantPinnedAnnouncementTag,
} from "./cache-tags";
import { getMessagesFor } from "./messages";

export interface MemberAnnouncementItem {
  id: string;
  title: string;
  body: string;
  linkUrl: string;
  isRead: boolean;
  createdAt: string;
}

/**
 * Tag the cached inbox read carries, so `updateTag` in the Server Action
 * makes a mark-read visible on the next list render.
 */
export const announcementsCacheTag = tenantAnnouncementsTag;

/**
 * `locale` reaches the read as an argument rather than being resolved inside
 * the cached scope, so the wording a failure is stored with belongs to the
 * cache key instead of to whichever request filled the entry.
 */
const mapErrorToMessage = async (
  error: unknown,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);

  return rpcErrorMessage(error, t("host.announcements.list_failed"), {
    locale,
  });
};

/**
 * The generated `AnnouncementItem` fields {@link mapAnnouncementItem} reads.
 * Naming them against the message type is what makes a proto rename fail here —
 * a restated structural type keeps compiling, and the inbox then renders a row
 * with an empty title and body with nothing pointing at the cause.
 */
type RawAnnouncementItem = Pick<
  AnnouncementItem,
  "body" | "createdAt" | "id" | "isRead" | "linkUrl" | "title"
>;

const mapAnnouncementItem = (
  item: RawAnnouncementItem
): MemberAnnouncementItem => ({
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
  /** UI locale the failure wording belongs to; part of the cache key. */
  locale: Locale;
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
  | ({ ok: false; message: string } & MyAnnouncementsPage);

const emptyListPage = {
  announcements: [] as MemberAnnouncementItem[],
  nextToken: "",
  previousToken: "",
};

type CachedListMyAnnouncementsResult = ListMyAnnouncementsResult & {
  error?: unknown;
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
    };
  } catch (error) {
    dropFailedCacheEntry();
    return {
      ...emptyListPage,
      error,
      message: await mapErrorToMessage(error, options.locale),
      ok: false,
    };
  }
};

export const listMyAnnouncements = async (
  tenantId: string,
  sessionId: string | undefined,
  options: ListMyAnnouncementsOptions
): Promise<ListMyAnnouncementsResult> => {
  const { error, ...result } = await readAnnouncementList(
    tenantId,
    sessionId,
    options
  );
  if (error !== undefined) {
    rethrowUnclassifiedRpcError(error);
  }
  return result;
};

const getMyAnnouncementInputSchema = z.object({
  announcementId: z.string().trim().pipe(z.uuid()),
  tenantId: tenantIdSchema,
});

interface CachedGetMyAnnouncementResult {
  error?: unknown;
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
    return { value: null };
  }

  applyCacheTag(announcementsCacheTag(parsed.data.tenantId));

  const sid = await resolveAccessToken(sessionId);
  if (!sid) {
    return { value: null };
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
      return { value: null };
    }

    return { value: mapAnnouncementItem(response.announcement) };
  } catch (error) {
    dropFailedCacheEntry();
    return { error, value: null };
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
  if (result.error !== undefined) {
    rethrowUnclassifiedRpcError(result.error);
  }
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
    if (isUnauthenticatedRpcError(error)) {
      throw error;
    }
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
    if (isUnauthenticatedRpcError(error)) {
      throw error;
    }
    rethrowUnclassifiedRpcError(error);
    return 0;
  }
};

/** What the banner above every page shows, and the link it carries. */
export interface PinnedAnnouncement {
  id: string;
  title: string;
  body: string;
  linkUrl: string;
}

interface CachedPinnedAnnouncementResult {
  error?: unknown;
  value: PinnedAnnouncement | null;
}

/**
 * The announcement the tenant has pinned right now, or null when it has none.
 *
 * Unlike the inbox reads this one names no reader — the API answers it without
 * a session — so one entry serves every visitor of a tenant and the band above
 * the page costs no round trip per request. What makes the entry stale is a pin,
 * an unpin, or the window closing, and each of those drops
 * {@link tenantPinnedAnnouncementTag} from the side that knows it happened.
 *
 * A read that fails answers null: the banner is an addition to the page rather
 * than part of it, and a site that cannot say what is pinned should show the
 * page rather than an apology above it.
 */
const readPinnedAnnouncement = async (
  tenantId: string
): Promise<CachedPinnedAnnouncementResult> => {
  "use cache: remote";

  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId) {
    return { value: null };
  }
  applyCacheTag(tenantPinnedAnnouncementTag(normalizedTenantId));

  try {
    const response = await apiClient.auth.getPinnedAnnouncement({
      tenant: { tenantId: normalizedTenantId },
    });
    if (!response.announcement) {
      return { value: null };
    }

    const { body, id, linkUrl, title } = response.announcement;
    return { value: { body, id, linkUrl, title } };
  } catch (error) {
    dropFailedCacheEntry();
    return { error, value: null };
  }
};

export const getPinnedAnnouncement = async (
  tenantId: string
): Promise<PinnedAnnouncement | null> => {
  const result = await readPinnedAnnouncement(tenantId);
  if (result.error !== undefined) {
    rethrowUnclassifiedRpcError(result.error);
  }
  return result.value;
};
