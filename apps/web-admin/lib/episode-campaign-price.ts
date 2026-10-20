import type { AdminEpisodeCampaignPrice } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  Code,
  rethrowUnclassifiedRpcError,
  rpcErrorCode,
  rpcErrorHasFieldViolation,
} from "@publira/api-client/errors";
import { forEachPageWithToken } from "@publira/api-client/pagination";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheLife, cacheTag } from "next/cache";

import { rethrowUnauthenticatedRpcError } from "./admin-auth-shared";
import { verifyAdminPageSession } from "./admin-page-session";
import { apiClient, withServiceHeaders, withSessionHeaders } from "./api";
import { episodesCacheTag } from "./episode";
import { getMessagesFor } from "./messages";
import { getAccessToken } from "./session";

/**
 * A scheduled period during which one episode's permanent copy sells for
 * `price` rather than for the episode's own.
 */
export interface EpisodeCampaignPriceItem {
  id: string;
  episodeId: string;
  episodePublicId: string;
  episodeTitle: string;
  /** In the minor unit of the tenant currency, as an episode's price is. */
  price: number;
  /** RFC 3339. The campaign covers `startsAt` up to but not including `endsAt`. */
  startsAt: string;
  endsAt: string;
}

export type ListEpisodeCampaignPricesResult =
  | { ok: true; campaignPrices: EpisodeCampaignPriceItem[] }
  | { ok: false; message: string };

export type CreateEpisodeCampaignPriceResult =
  | { ok: true; campaignPrice: EpisodeCampaignPriceItem }
  | { ok: false; message: string };

export type CreateSeriesCampaignPricesResult =
  | { ok: true; campaignPrices: EpisodeCampaignPriceItem[] }
  | { ok: false; message: string };

export type DeleteEpisodeCampaignPriceResult =
  | {
      ok: true;
      /** The campaign was gone before this delete reached it. */
      alreadyDeleted: boolean;
    }
  | { ok: false; message: string };

/**
 * The tag every campaign price read is filed under. Every Action that
 * schedules or removes a campaign clears it, so the episode screens show the
 * change.
 */
export const episodeCampaignPricesCacheTag = (tenantId: string): string =>
  `episode-campaign-prices-${tenantId}`;

/** The generated fields {@link mapCampaignPrice} reads (see `series.ts`). */
type RawEpisodeCampaignPrice = Pick<
  AdminEpisodeCampaignPrice,
  | "endsAt"
  | "episodeId"
  | "episodePublicId"
  | "episodeTitle"
  | "id"
  | "price"
  | "startsAt"
>;

const mapCampaignPrice = (
  campaign: RawEpisodeCampaignPrice
): EpisodeCampaignPriceItem => ({
  endsAt: campaign.endsAt,
  episodeId: campaign.episodeId,
  episodePublicId: campaign.episodePublicId,
  episodeTitle: campaign.episodeTitle,
  id: campaign.id,
  price: campaign.price,
  startsAt: campaign.startsAt,
});

/**
 * The wording for a rejected schedule. A failed precondition is the overlap
 * the database refuses, which the editor fixes by choosing another period; a
 * refused price is one that does not undercut the episode's, which only the
 * server can compare, since the episode's price may have changed since the
 * form was rendered.
 */
const mapCreateErrorToMessage = async (
  error: unknown,
  messages: { fallback: string; priceNotCheaper: string },
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);
  if (
    rpcErrorHasFieldViolation(error, "starts_at") ||
    rpcErrorHasFieldViolation(error, "ends_at")
  ) {
    return t("admin.series.episodes.period.invalid");
  }
  if (rpcErrorHasFieldViolation(error, "price")) {
    return messages.priceNotCheaper;
  }
  if (rpcErrorHasFieldViolation(error, "currency")) {
    return t("admin.series.episodes.currency_changed");
  }
  if (rpcErrorHasFieldViolation(error, "episode_ids")) {
    return t("admin.series.episodes.campaign_prices.episodes_changed");
  }

  return rpcErrorMessage(error, messages.fallback, {
    locale,
    overrides: {
      "not-found": t("admin.series.episodes.series_not_found"),
      precondition: t("admin.series.episodes.campaign_prices.overlap"),
    },
  });
};

const listEpisodeCampaignPricesForTenant = async (
  input: { episodeId: string; tenantId: string },
  locale: Locale
): Promise<ListEpisodeCampaignPricesResult> => {
  "use cache";
  // A campaign can be scheduled or removed through the Admin API without this
  // app, and publira server revalidates only the storefront's tag when it is,
  // so the entry is refetched once it is a minute old rather than kept for the
  // default quarter of an hour.
  cacheLife("minutes");
  cacheTag(episodeCampaignPricesCacheTag(input.tenantId));
  // The rows carry the episode's title, which an episode write can change.
  cacheTag(episodesCacheTag(input.tenantId));

  const t = await getMessagesFor(locale);
  try {
    const campaignPrices: EpisodeCampaignPriceItem[] = [];
    const walkStop = await forEachPageWithToken(
      async (token, limit) => {
        const response = await apiClient.series.listEpisodeCampaignPrices(
          {
            limit,
            scope: { case: "episodeId", value: input.episodeId },
            tenant: { tenantId: input.tenantId },
            token,
          },
          withServiceHeaders()
        );
        return {
          items: response.campaignPrices ?? [],
          nextToken: response.nextToken ?? "",
        };
      },
      (items) => {
        for (const item of items) {
          campaignPrices.push(mapCampaignPrice(item));
        }
      }
    );

    // A partial list would hide a campaign the editor came here to remove.
    if (walkStop !== "completed") {
      dropFailedCacheEntry();
      return {
        message: t("admin.series.episodes.campaign_prices.list_failed"),
        ok: false,
      };
    }

    return { campaignPrices, ok: true };
  } catch (error) {
    // A `"use cache"` scope cannot rethrow: the fill would fail the whole
    // request. The entry is dropped instead, so the answer comes back as soon
    // as the API does.
    dropFailedCacheEntry();
    return {
      message: rpcErrorMessage(
        error,
        t("admin.series.episodes.campaign_prices.list_failed"),
        { locale }
      ),
      ok: false,
    };
  }
};

/**
 * Every campaign price scheduled on one episode, latest start first, the ones
 * already over included until someone deletes them.
 *
 * Read with the service credential: the list is the same for every operator
 * of the tenant, so one entry serves all of them.
 */
export const listEpisodeCampaignPrices = async (input: {
  episodeId: string;
}): Promise<ListEpisodeCampaignPricesResult> => {
  const { locale, tenantId } = await verifyAdminPageSession();
  return listEpisodeCampaignPricesForTenant({ ...input, tenantId }, locale);
};

export const createEpisodeCampaignPrice = async (
  input: {
    tenantId: string;
    episodeId: string;
    price: number;
    /** The currency `price` was read in, which the API checks again. */
    currency: string;
    startsAt: string;
    endsAt: string;
  },
  locale: Locale
): Promise<CreateEpisodeCampaignPriceResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.series.createEpisodeCampaignPrice(
      {
        currency: input.currency,
        endsAt: input.endsAt,
        episodeId: input.episodeId,
        price: input.price,
        startsAt: input.startsAt,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );
    if (!response.campaignPrice) {
      return {
        message: t("admin.series.episodes.campaign_prices.create_failed"),
        ok: false,
      };
    }

    return {
      campaignPrice: mapCampaignPrice(response.campaignPrice),
      ok: true,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: await mapCreateErrorToMessage(
        error,
        {
          fallback: t("admin.series.episodes.campaign_prices.create_failed"),
          priceNotCheaper: t(
            "admin.series.episodes.campaign_prices.validation.price_not_cheaper"
          ),
        },
        locale
      ),
      ok: false,
    };
  }
};

/**
 * Schedules one price and period on several episodes of a series in one
 * all-or-nothing call. Unlike a free reading period, a campaign names its
 * episodes: its price has to undercut each one's own.
 */
export const createSeriesCampaignPrices = async (
  input: {
    tenantId: string;
    seriesId: string;
    episodeIds: readonly string[];
    price: number;
    /** The currency `price` was read in, which the API checks again. */
    currency: string;
    startsAt: string;
    endsAt: string;
  },
  locale: Locale
): Promise<CreateSeriesCampaignPricesResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.series.createSeriesCampaignPrices(
      {
        currency: input.currency,
        endsAt: input.endsAt,
        episodeIds: [...input.episodeIds],
        price: input.price,
        seriesId: input.seriesId,
        startsAt: input.startsAt,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      campaignPrices: (response.campaignPrices ?? []).map((campaign) =>
        mapCampaignPrice(campaign)
      ),
      ok: true,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: await mapCreateErrorToMessage(
        error,
        {
          fallback: t("admin.series.episodes.campaign_prices.bulk_failed"),
          priceNotCheaper: t(
            "admin.series.episodes.campaign_prices.validation.bulk_price_not_cheaper"
          ),
        },
        locale
      ),
      ok: false,
    };
  }
};

export const deleteEpisodeCampaignPrice = async (
  input: { tenantId: string; campaignPriceId: string },
  locale: Locale
): Promise<DeleteEpisodeCampaignPriceResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    await apiClient.series.deleteEpisodeCampaignPrice(
      {
        campaignPriceId: input.campaignPriceId,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );
    return { alreadyDeleted: false, ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    // Another operator deleted it first, or an earlier attempt committed and
    // lost its response. Either way the campaign is gone, which is what the
    // delete asked for, so the caller still clears the list that shows it.
    // `NotFound` alone: a refused permission is not a campaign that is gone.
    if (rpcErrorCode(error) === Code.NotFound) {
      return { alreadyDeleted: true, ok: true };
    }
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        t("admin.series.episodes.campaign_prices.delete_failed"),
        { locale }
      ),
      ok: false,
    };
  }
};
