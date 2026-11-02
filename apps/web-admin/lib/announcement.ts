import {
  AnnouncementDelivery,
  SubscriptionState,
} from "@publira/api-client/admin/announcement";
import type { AnnouncementAudience } from "@publira/api-client/admin/announcement";
import type { AdminAnnouncement } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
} from "@publira/api-client/errors";
import { forEachPageWithToken } from "@publira/api-client/pagination";
import { getLocales, parseLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheTag } from "next/cache";

import type {
  AnnouncementAudienceCondition,
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

/** The tag every announcement read is filed under, and every announcement write drops. */
export const announcementsCacheTag = (tenantId: string): string =>
  `announcements-${tenantId}`;

const mapErrorMessage = (
  cause: unknown,
  fallback: string,
  locale: Locale
): string => rpcErrorMessage(cause, fallback, { locale });

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

/**
 * A stored audience as the console holds it. A condition this build does not
 * know, or a locale it serves no catalog for, is left out: the form can neither
 * show nor post it. The API answers every condition it stores, so an audience
 * that comes back empty is still a targeted one and stays an empty array.
 */
const mapAudience = (
  audience: Pick<AnnouncementAudience, "conditions"> | undefined
): AnnouncementAudienceCondition[] | null => {
  if (!audience) {
    return null;
  }

  const conditions: AnnouncementAudienceCondition[] = [];

  for (const { condition } of audience.conditions ?? []) {
    switch (condition?.case) {
      case "followsSeries": {
        conditions.push({
          seriesPublicId: condition.value.seriesPublicId,
          type: "follows_series",
        });
        break;
      }

      case "boughtSeriesEpisode": {
        conditions.push({
          seriesPublicId: condition.value.seriesPublicId,
          type: "bought_series_episode",
        });
        break;
      }

      case "subscription": {
        conditions.push({
          planPublicId: condition.value.planPublicId,
          state:
            condition.value.state === SubscriptionState.ENDED
              ? "ended"
              : "active",
          type: "subscription",
        });
        break;
      }

      case "neverPurchased": {
        conditions.push({ type: "never_purchased" });
        break;
      }

      case "lastReadDaysAgo": {
        conditions.push({
          days: condition.value.days,
          type: "last_read_days_ago",
        });
        break;
      }

      case "signedUpWithinDays": {
        conditions.push({
          days: condition.value.days,
          type: "signed_up_within_days",
        });
        break;
      }

      case "locale": {
        const code = parseLocale(condition.value.locale);

        if (code) {
          conditions.push({ locale: code, type: "locale" });
        }

        break;
      }

      case "hasMobilePushDevice": {
        conditions.push({ type: "has_mobile_push_device" });
        break;
      }

      default: {
        break;
      }
    }
  }

  return conditions;
};

/** The audience every request that takes one carries, as the client accepts it. */
type AudienceRequest = Parameters<
  typeof apiClient.announcement.countAnnouncementAudience
>[0]["audience"];

/** One condition of {@link AudienceRequest}. */
type AudienceConditionRequest = NonNullable<
  NonNullable<AudienceRequest>["conditions"]
>[number];

/** The audience as a request carries it; `null` sends none, which is everyone. */
const toAudienceRequest = (
  conditions: readonly AnnouncementAudienceCondition[] | null
): AudienceRequest => {
  if (!conditions) {
    return undefined;
  }

  return {
    conditions: conditions.map((condition): AudienceConditionRequest => {
      // The literals below are checked against the request's own shape, so a
      // `case` that stops naming a field of the proto fails here.
      switch (condition.type) {
        case "follows_series": {
          return {
            condition: {
              case: "followsSeries",
              value: { seriesPublicId: condition.seriesPublicId },
            },
          };
        }

        case "bought_series_episode": {
          return {
            condition: {
              case: "boughtSeriesEpisode",
              value: { seriesPublicId: condition.seriesPublicId },
            },
          };
        }

        case "subscription": {
          return {
            condition: {
              case: "subscription",
              value: {
                planPublicId: condition.planPublicId,
                state:
                  condition.state === "ended"
                    ? SubscriptionState.ENDED
                    : SubscriptionState.ACTIVE,
              },
            },
          };
        }

        case "never_purchased": {
          return {
            condition: { case: "neverPurchased", value: {} },
          };
        }

        case "last_read_days_ago": {
          return {
            condition: {
              case: "lastReadDaysAgo",
              value: { days: condition.days },
            },
          };
        }

        case "signed_up_within_days": {
          return {
            condition: {
              case: "signedUpWithinDays",
              value: { days: condition.days },
            },
          };
        }

        case "locale": {
          return {
            condition: {
              case: "locale",
              value: { locale: condition.locale },
            },
          };
        }

        case "has_mobile_push_device": {
          return {
            condition: { case: "hasMobilePushDevice", value: {} },
          };
        }

        default: {
          // SAFETY: the switch covers every member of the union.
          return condition satisfies never;
        }
      }
    }),
  };
};

/** The generated `AdminAnnouncement` fields {@link mapAnnouncement} reads (see `series.ts`). */
type RawAnnouncement = Pick<
  AdminAnnouncement,
  | "audience"
  | "body"
  | "createdAt"
  | "deliverAt"
  | "deliveredAt"
  | "delivery"
  | "id"
  | "linkUrl"
  | "pinned"
  | "pinnedUntil"
  | "title"
  | "translations"
>;

const mapAnnouncement = (item: RawAnnouncement): AnnouncementItem => {
  // A code this build has no catalog for cannot be named on screen or written
  // in a tab, so it is left out rather than shown raw.
  const translations = (item.translations ?? []).flatMap(
    ({ body, locale, title }) => {
      const code = parseLocale(locale);

      return code ? [{ body, locale: code, title }] : [];
    }
  );

  return {
    audience: mapAudience(item.audience),
    body: item.body,
    createdAt: item.createdAt,
    deliverAt: item.deliverAt ?? "",
    deliveredAt: item.deliveredAt ?? "",
    delivery: deliveryValues[item.delivery] ?? "preferred",
    id: item.id,
    linkUrl: item.linkUrl,
    pinned: item.pinned,
    pinnedUntil: item.pinnedUntil,
    title: item.title,
    // The registry's order, the one the form's tabs are in: the translations of
    // one announcement are written together, so the order they were stored in
    // says nothing.
    translatedLocales: getLocales().filter((code) =>
      translations.some(({ locale }) => locale === code)
    ),
    translations,
  };
};

const listAnnouncementsForSession = async (
  tenantId: string,
  locale: Locale,
  options: CursorPageOptions,
  sessionId: string
): Promise<CachedRead<ListAnnouncementsResult>> => {
  "use cache: private";
  cacheTag(announcementsCacheTag(tenantId));

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

export type GetAnnouncementResult =
  | { ok: true; announcement: AnnouncementItem | null }
  | { ok: false; message: string; requiresSignIn: boolean };

const getAnnouncementForSession = async (
  tenantId: string,
  announcementId: string,
  locale: Locale,
  sessionId: string
): Promise<CachedRead<GetAnnouncementResult>> => {
  "use cache: private";
  cacheTag(announcementsCacheTag(tenantId));

  const t = await getMessagesFor(locale);

  if (!sessionId) {
    dropFailedCacheEntry();

    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: true,
    };
  }

  try {
    let found: AnnouncementItem | null = null;

    await forEachPageWithToken(
      async (token, limit) => {
        const response = await apiClient.announcement.listAnnouncements(
          { limit, tenant: { tenantId }, token },
          withSessionHeaders(sessionId)
        );

        return {
          items: response.announcements ?? [],
          nextToken: response.nextToken ?? "",
        };
      },
      (items) => {
        const item = items.find(({ id }) => id === announcementId);

        if (!item) {
          return true;
        }

        found = mapAnnouncement(item);

        return false;
      }
    );

    return { announcement: found, ok: true };
  } catch (error) {
    dropFailedCacheEntry();

    return {
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
 * One announcement of the tenant, for the screen it is edited on; `null` when
 * the tenant has none by that id.
 *
 * The API reads announcements only as a list, so this walks the list from its
 * newest page and stops at the page that holds it. A scheduled announcement,
 * the one kind that is edited, was written recently and sits on the first
 * pages. An announcement past the walk's budget reads as missing rather than
 * as a failure.
 */
export const getAnnouncement = async (
  input: { tenantId: string; announcementId: string },
  locale: Locale
): Promise<GetAnnouncementResult> =>
  settleCachedRead(
    await getAnnouncementForSession(
      input.tenantId,
      input.announcementId,
      locale,
      await getAccessToken()
    )
  );

/** Every field of an announcement a create or a save of a scheduled one sends. */
export interface AnnouncementInput {
  tenantId: string;
  /** Every language the announcement is written in, the default one included. */
  translations: readonly AnnouncementTranslationInput[];
  linkUrl: string;
  delivery: AnnouncementDeliveryValue;
  pinned: boolean;
  /** RFC 3339 instant, or empty for a banner with no end. */
  pinnedUntil: string;
  /** The readers it is addressed to; `null` addresses everyone who opens the site. */
  audience: readonly AnnouncementAudienceCondition[] | null;
  /** RFC 3339 instant it goes out at, or empty to deliver it now. */
  deliverAt: string;
}

export type AnnouncementWriteResult =
  | { ok: true }
  | { ok: false; message: string };

const announcementRequest = (input: AnnouncementInput) => ({
  audience: toAudienceRequest(input.audience),
  deliverAt: input.deliverAt,
  delivery: deliveryEnums[input.delivery],
  linkUrl: input.linkUrl,
  pinned: input.pinned,
  pinnedUntil: input.pinnedUntil,
  tenant: { tenantId: input.tenantId },
  translations: [...input.translations],
});

export const createAnnouncement = async (
  input: AnnouncementInput,
  locale: Locale
): Promise<AnnouncementWriteResult> => {
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
      announcementRequest(input),
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
 * Replace the whole of a scheduled announcement. One that has gone out in the
 * meantime is refused, since it is what its readers were pointed at.
 */
export const updateAnnouncement = async (
  input: AnnouncementInput & { announcementId: string },
  locale: Locale
): Promise<AnnouncementWriteResult> => {
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
    await apiClient.announcement.updateAnnouncement(
      { ...announcementRequest(input), announcementId: input.announcementId },
      withSessionHeaders(sessionId)
    );

    return { ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: rpcErrorMessage(error, t("admin.announcements.update_failed"), {
        locale,
        overrides: {
          precondition: t("admin.announcements.already_delivered"),
        },
      }),
      ok: false,
    };
  }
};

/** Delete a scheduled announcement, which no reader has seen yet. */
export const deleteAnnouncement = async (
  input: { tenantId: string; announcementId: string },
  locale: Locale
): Promise<AnnouncementWriteResult> => {
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
    await apiClient.announcement.deleteAnnouncement(
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
      message: rpcErrorMessage(error, t("admin.announcements.delete_failed"), {
        locale,
        overrides: {
          precondition: t("admin.announcements.already_delivered"),
        },
      }),
      ok: false,
    };
  }
};

export type CountAnnouncementAudienceResult =
  | { ok: true; readerCount: number }
  | { ok: false };

/**
 * How many readers an audience selects now: those a delivery at this moment
 * would reach. The form shows it as advice, so a failure is reported as one
 * without saying why.
 */
export const countAnnouncementAudience = async (input: {
  tenantId: string;
  audience: readonly AnnouncementAudienceCondition[];
}): Promise<CountAnnouncementAudienceResult> => {
  const sessionId = await getAccessToken();

  if (!sessionId) {
    return { ok: false };
  }

  try {
    const response = await apiClient.announcement.countAnnouncementAudience(
      {
        audience: toAudienceRequest(input.audience),
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return { ok: true, readerCount: Number(response.readerCount ?? 0) };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return { ok: false };
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
