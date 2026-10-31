import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  Code,
  ConnectError,
  isExpectedNullableRpcError,
  isMissingResourceRpcError,
  isUnauthenticatedRpcError,
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
} from "@publira/api-client/errors";
import type { AnnouncementItem } from "@publira/api-client/public/types";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import type { CachedReadResult } from "@publira/utils/cached-read";
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
import { localizedReadFailure } from "./read-failure";
import { publishedLocalesFrom, servedLocaleFrom } from "./served-locale";

export interface MemberAnnouncementItem {
  id: string;
  title: string;
  body: string;
  linkUrl: string;
  isRead: boolean;
  createdAt: string;
  /**
   * The locale of the translation the title and body were taken from. It
   * differs from the locale the reader asked for when the announcement was not
   * written in that one.
   */
  locale: Locale;
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

  return rpcErrorMessage(error, t("storefront.announcements.list_failed"), {
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
  "body" | "createdAt" | "id" | "isRead" | "linkUrl" | "locale" | "title"
>;

const mapAnnouncementItem = (
  item: RawAnnouncementItem,
  requestedLocale: Locale
): MemberAnnouncementItem => ({
  body: item.body,
  createdAt: item.createdAt,
  id: item.id,
  isRead: item.isRead,
  linkUrl: item.linkUrl,
  locale: servedLocaleFrom(item.locale, requestedLocale),
  title: item.title,
});

const mapAnnouncementItems = (
  response: Awaited<ReturnType<typeof apiClient.auth.listAnnouncements>>,
  requestedLocale: Locale
): MemberAnnouncementItem[] =>
  (response.announcements ?? []).map((item) =>
    mapAnnouncementItem(item, requestedLocale)
  );

/**
 * Cursor pagination: `token` is whatever the previous response returned as
 * `previousToken` / `nextToken`, and is opaque to the caller. Contract:
 * `proto/README.md`.
 */
export interface ListMyAnnouncementsOptions {
  limit?: number;
  /**
   * The reader's locale: the language each announcement is listed in, where it
   * has a translation in it, and the one the failure wording belongs to. Part
   * of the cache key.
   */
  locale: Locale;
  token?: string;
}

const listAnnouncementsRpc = (
  tenantId: string,
  sessionId: string,
  { limit = 20, locale, token = "" }: ListMyAnnouncementsOptions
): Promise<Awaited<ReturnType<typeof apiClient.auth.listAnnouncements>>> =>
  apiClient.auth.listAnnouncements(
    {
      limit,
      locale,
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

/**
 * What crosses the cache boundary is a verdict, never the caught error: an
 * error that leaves a `"use cache"` scope is re-created by React Flight, and a
 * production build withholds its message and drops its `Code`, so past the
 * boundary every failure would classify as unexpected — an unreachable API
 * included.
 */
type CachedListMyAnnouncementsResult = ListMyAnnouncementsResult & {
  unexpected: boolean;
};

const readAnnouncementList = async (
  tenantId: string,
  sid: string,
  options: ListMyAnnouncementsOptions
): Promise<CachedListMyAnnouncementsResult> => {
  "use cache: private";
  applyCacheTag(announcementsCacheTag(tenantId));

  try {
    const response = await listAnnouncementsRpc(tenantId, sid, options);

    return {
      announcements: mapAnnouncementItems(response, options.locale),
      nextToken: response.nextToken ?? "",
      ok: true,
      previousToken: response.previousToken ?? "",
      unexpected: false,
    };
  } catch (error) {
    dropFailedCacheEntry();

    return {
      ...emptyListPage,
      message: await mapErrorToMessage(error, options.locale),
      ok: false,
      unexpected: rpcErrorDisposition(error) === "unexpected",
    };
  }
};

export const listMyAnnouncements = async (
  tenantId: string,
  sessionId: string | undefined,
  options: ListMyAnnouncementsOptions
): Promise<ListMyAnnouncementsResult> => {
  const { unexpected, ...result } = await readAnnouncementList(
    tenantId,
    await resolveAccessToken(sessionId),
    options
  );

  if (unexpected && !result.ok) {
    throw new Error(result.message);
  }

  return result;
};

const announcementInputSchema = z.object({
  announcementId: z.string().trim().pipe(z.uuid()),
  tenantId: tenantIdSchema,
});

/**
 * Like the list read, this hands a verdict across the cache boundary rather
 * than the caught error. `"unauthenticated"` is kept apart from a bug so the
 * caller can send the reader back through sign-in instead of to an error
 * screen.
 */
type CachedGetMyAnnouncementResult =
  | { failure: "unauthenticated" | "unexpected" }
  | { value: MemberAnnouncementItem | null };

const readMyAnnouncement = async (
  tenantId: string,
  announcementId: string,
  locale: Locale,
  sid: string
): Promise<CachedGetMyAnnouncementResult> => {
  "use cache: private";
  applyCacheTag(announcementsCacheTag(tenantId));

  if (!sid) {
    return { value: null };
  }

  try {
    const response = await apiClient.auth.getAnnouncement(
      {
        announcementId,
        locale,
        tenant: { tenantId },
      },
      buildSessionHeaders(sid)
    );

    if (!response.announcement) {
      return { value: null };
    }

    return { value: mapAnnouncementItem(response.announcement, locale) };
  } catch (error) {
    dropFailedCacheEntry();

    if (isUnauthenticatedRpcError(error)) {
      return { failure: "unauthenticated" };
    }

    if (rpcErrorDisposition(error) === "unexpected") {
      return { failure: "unexpected" };
    }

    // A missing row, and any other failure the API classified, both answer
    // "nothing to open": the action that asked simply does not navigate.
    return { value: null };
  }
};

/**
 * Session-authorized get-by-id. A form-supplied `linkUrl` is not a substitute.
 *
 * A session the API rejects is thrown as an `Unauthenticated` `ConnectError`,
 * rebuilt here outside the cache scope, so `withPublicSessionReauth` sends the
 * reader to sign in again; an unexpected failure is thrown as a plain error.
 */
export const getMyAnnouncement = async (
  tenantId: string,
  announcementId: string,
  locale: Locale,
  sessionId?: string
): Promise<MemberAnnouncementItem | null> => {
  const parsed = announcementInputSchema.safeParse({
    announcementId,
    tenantId,
  });

  if (!parsed.success) {
    // Same null as a missing row: a malformed id is not a distinct outcome.
    return null;
  }

  const result = await readMyAnnouncement(
    parsed.data.tenantId,
    parsed.data.announcementId,
    locale,
    await resolveAccessToken(sessionId)
  );

  if ("value" in result) {
    return result.value;
  }

  if (result.failure === "unauthenticated") {
    throw new ConnectError(
      "announcement read rejected the session",
      Code.Unauthenticated
    );
  }

  throw new Error("Could not read the announcement.");
};

/** One announcement as its own page shows it. */
export interface AnnouncementDetail {
  id: string;
  title: string;
  body: string;
  linkUrl: string;
  createdAt: string;
  /** The locale of the translation that was served. */
  locale: Locale;
  /** Every locale the announcement has a translation in, the served one included. */
  publishedLocales: readonly Locale[];
}

/**
 * The generated `AnnouncementItem` fields {@link getAnnouncement} keeps. The
 * read state is left out: the page is read without a session.
 */
type AnnouncementDetailFields = Pick<
  AnnouncementItem,
  "body" | "createdAt" | "id" | "linkUrl" | "locale" | "title"
>;

const toAnnouncementDetail = (
  item: AnnouncementDetailFields,
  locales: readonly string[] | undefined,
  requestedLocale: Locale
): AnnouncementDetail => {
  const servedLocale = servedLocaleFrom(item.locale, requestedLocale);

  return {
    body: item.body,
    createdAt: item.createdAt,
    id: item.id,
    linkUrl: item.linkUrl,
    locale: servedLocale,
    publishedLocales: publishedLocalesFrom(locales, servedLocale),
    title: item.title,
  };
};

/**
 * One announcement in `locale`, else the tenant default's translation, else
 * its oldest — the page `/announcements/<id>` shows.
 *
 * It names no reader, so one entry serves every visitor: an announcement is the
 * tenant's word to everyone who opens the site, and read state belongs to the
 * list. A missing, malformed, or other-tenant id is `ok: true` with `null`; a
 * failed read is `ok: false`, a value rather than a throw because a `"use
 * cache"` fill that throws fails the whole request.
 */
export const getAnnouncement = async (
  tenantId: string,
  announcementId: string,
  locale: Locale
): Promise<CachedReadResult<AnnouncementDetail | null>> => {
  "use cache: remote";

  const parsed = announcementInputSchema.safeParse({
    announcementId,
    tenantId,
  });

  if (!parsed.success) {
    return { ok: true, value: null };
  }

  applyCacheTag(announcementsCacheTag(parsed.data.tenantId));

  try {
    const response = await apiClient.auth.getAnnouncement({
      announcementId: parsed.data.announcementId,
      locale,
      tenant: { tenantId: parsed.data.tenantId },
    });

    if (!response.announcement) {
      return { ok: true, value: null };
    }

    return {
      ok: true,
      value: toAnnouncementDetail(
        response.announcement,
        response.locales,
        locale
      ),
    };
  } catch (error) {
    if (isMissingResourceRpcError(error)) {
      return { ok: true, value: null };
    }

    return localizedReadFailure(
      error,
      locale,
      "storefront.announcements.read_failed"
    );
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
  /** The locale of the translation the title and body were taken from. */
  locale: Locale;
}

/**
 * The announcement the tenant has pinned right now, in `locale` or the
 * translation it falls back to, or null when it has none.
 *
 * Unlike the inbox reads this one names no reader — the API answers it without
 * a session — so one entry per language serves every visitor of a tenant and
 * the band above the page costs no round trip per request. What makes the
 * entry stale is a pin, an unpin, or the window closing, and each of those drops
 * {@link tenantPinnedAnnouncementTag} from the side that knows it happened.
 *
 * A read that fails answers null: the banner is an addition to the page rather
 * than part of it, and a site that cannot say what is pinned should show the
 * page rather than an apology above it — an unexpected failure included,
 * which is reported in the log rather than thrown.
 *
 * The failure is classified here, inside the cache scope, and never handed out.
 * An error that leaves a `"use cache"` scope loses its `Code` and has its
 * message withheld in production, so past this point an unreachable API reads
 * as unexpected too — and the banner renders on every page under `(site)`,
 * where a throw replaces the whole site with the locale segment's error screen.
 */
export const getPinnedAnnouncement = async (
  tenantId: string,
  locale: Locale
): Promise<PinnedAnnouncement | null> => {
  "use cache: remote";

  const normalizedTenantId = tenantId.trim();

  if (!normalizedTenantId) {
    return null;
  }

  applyCacheTag(tenantPinnedAnnouncementTag(normalizedTenantId));

  try {
    const response = await apiClient.auth.getPinnedAnnouncement({
      locale,
      tenant: { tenantId: normalizedTenantId },
    });

    if (!response.announcement) {
      return null;
    }

    const { body, id, linkUrl, title } = response.announcement;

    return {
      body,
      id,
      linkUrl,
      locale: servedLocaleFrom(response.announcement.locale, locale),
      title,
    };
  } catch (error) {
    if (!isExpectedNullableRpcError(error)) {
      console.warn("[web-storefront] getPinnedAnnouncement failed", error);
    }

    dropFailedCacheEntry();

    return null;
  }
};
