import { AnnouncementDelivery } from "@publira/api-client/admin/announcement";
import type { AdminAnnouncement } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
} from "@publira/api-client/errors";
import { getLocales, parseLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheTag } from "next/cache";

import type {
  AnnouncementDeliveryValue,
  AnnouncementItem,
  AnnouncementTranslationInput,
  ListAnnouncementsResult,
} from "../app/[tenant_id]/(protected)/announcements/announcement-types";
import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import type { CachedRead } from "./cached-read";
import { settleCachedRead } from "./cached-read";
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

/** The API answers no unspecified delivery, and reads one in a request as preferred. */
const deliveryValues: Record<AnnouncementDelivery, AnnouncementDeliveryValue> =
  {
    [AnnouncementDelivery.UNSPECIFIED]: "preferred",
    [AnnouncementDelivery.PREFERRED]: "preferred",
    [AnnouncementDelivery.EVERYONE]: "everyone",
  };

const deliveryEnums: Record<AnnouncementDeliveryValue, AnnouncementDelivery> = {
  everyone: AnnouncementDelivery.EVERYONE,
  preferred: AnnouncementDelivery.PREFERRED,
};

/** The generated `AdminAnnouncement` fields {@link mapAnnouncement} reads (see `series.ts`). */
type RawAnnouncement = Pick<
  AdminAnnouncement,
  | "body"
  | "createdAt"
  | "delivery"
  | "id"
  | "linkUrl"
  | "pinned"
  | "pinnedUntil"
  | "title"
  | "translations"
>;

const mapAnnouncement = (item: RawAnnouncement): AnnouncementItem => ({
  body: item.body,
  createdAt: item.createdAt,
  delivery: deliveryValues[item.delivery] ?? "preferred",
  id: item.id,
  linkUrl: item.linkUrl,
  pinned: item.pinned,
  pinnedUntil: item.pinnedUntil,
  title: item.title,
  // The registry's order, the one the form's tabs are in: the translations of
  // one announcement are written together, so the order they were stored in
  // says nothing. A code this build has no catalog for cannot be named on
  // screen, so it is left out rather than shown raw.
  translatedLocales: getLocales().filter((code) =>
    (item.translations ?? []).some(({ locale }) => parseLocale(locale) === code)
  ),
});

const listAnnouncementsForSession = async (
  tenantId: string,
  locale: Locale,
  options: CursorPageOptions,
  sessionId: string
): Promise<CachedRead<ListAnnouncementsResult>> => {
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
      unexpected: rpcErrorDisposition(error) === "unexpected",
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
  settleCachedRead(
    await listAnnouncementsForSession(
      tenantId,
      locale,
      options,
      await getAccessToken()
    )
  );

export const createAnnouncement = async (
  input: {
    tenantId: string;
    /** Every language the announcement is written in, the default one included. */
    translations: readonly AnnouncementTranslationInput[];
    linkUrl: string;
    delivery: AnnouncementDeliveryValue;
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
        delivery: deliveryEnums[input.delivery],
        linkUrl: input.linkUrl,
        pinned: input.pinned,
        pinnedUntil: input.pinnedUntil,
        tenant: { tenantId: input.tenantId },
        translations: [...input.translations],
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
