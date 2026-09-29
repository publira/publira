import type { AdminAnnouncement } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheTag } from "next/cache";

import type {
  ListAnnouncementsResult,
  AnnouncementItem,
} from "../app/[tenant_id]/(protected)/announcements/announcement-types";
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
import { getAccessToken } from "./session";

const mapErrorMessage = (
  error: unknown,
  fallback: string,
  locale: Locale
): string => rpcErrorMessage(error, fallback, { locale });

/** The generated `AdminAnnouncement` fields {@link mapAnnouncement} reads (see `series.ts`). */
type RawAnnouncement = Pick<
  AdminAnnouncement,
  "body" | "createdAt" | "id" | "linkUrl" | "pinned" | "pinnedUntil" | "title"
>;

const mapAnnouncement = (item: RawAnnouncement): AnnouncementItem => ({
  body: item.body,
  createdAt: item.createdAt,
  id: item.id,
  linkUrl: item.linkUrl,
  pinned: item.pinned,
  pinnedUntil: item.pinnedUntil,
  title: item.title,
});

const listAnnouncementsForSession = async (
  tenantId: string,
  locale: Locale,
  options: CursorPageOptions,
  sessionId: string
): Promise<ListAnnouncementsResult> => {
  "use cache: private";
  cacheTag(`announcements-${tenantId}`);

  const t = await getMessagesFor(locale);
  if (!sessionId) {
    dropFailedCacheEntry();
    return {
      ...emptyCursorPageTokens,
      announcements: [],
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: true,
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
    dropFailedCacheEntry();
    return {
      ...emptyCursorPageTokens,
      announcements: [],
      message: mapErrorMessage(
        error,
        t("admin.announcements.list_failed"),
        locale
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
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
  locale: Locale,
  options: CursorPageOptions = {}
): Promise<ListAnnouncementsResult> =>
  listAnnouncementsForSession(
    tenantId,
    locale,
    options,
    await getAccessToken()
  );

export const createAnnouncement = async (
  input: {
    tenantId: string;
    title: string;
    body: string;
    linkUrl: string;
    pinned: boolean;
    /** RFC 3339 instant, or empty for a banner with no end. */
    pinnedUntil: string;
  },
  locale: Locale
): Promise<{ ok: true } | { ok: false; message: string }> => {
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
    await apiClient.announcement.createAnnouncement(
      {
        body: input.body,
        linkUrl: input.linkUrl,
        pinned: input.pinned,
        pinnedUntil: input.pinnedUntil,
        tenant: { tenantId: input.tenantId },
        title: input.title,
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
        t("admin.announcements.create_failed"),
        locale
      ),
      ok: false,
    };
  }
};
/**
 * Stop showing an announcement as a banner, leaving the announcement itself in
 * the list it was posted to. It is what an operator reaches for when the event
 * a notice was about is over, which is not the same as deleting the notice.
 */
export const unpinAnnouncement = async (
  input: { tenantId: string; announcementId: string },
  locale: Locale
): Promise<{ ok: true } | { ok: false; message: string }> => {
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
    await apiClient.announcement.unpinAnnouncement(
      {
        announcementId: input.announcementId,
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
        t("admin.announcements.unpin_failed"),
        locale
      ),
      ok: false,
    };
  }
};
