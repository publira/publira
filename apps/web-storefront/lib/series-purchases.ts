import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  isMissingResourceRpcError,
  rethrowUnclassifiedRpcError,
} from "@publira/api-client/errors";
import { ClientSurface } from "@publira/api-client/public/types";
import type { SeriesRemainderOffer } from "@publira/api-client/public/types";
import type { Locale } from "@publira/i18n";
import { cache } from "react";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import { getMessagesFor } from "./messages";

/**
 * The rest of the series as one checkout would sell it to the reader now. The
 * amounts are in the minor unit of the tenant currency, as an episode's price
 * is.
 */
export interface SeriesRemainderQuote {
  /** How many episodes the checkout would sell, never 0. */
  episodeCount: number;
  /** The sum of those episodes' prices. */
  listPrice: number;
  /** The series' bundle discount in whole percent; 0 when it takes none. */
  discountPercent: number;
  /** What the reader pays: `listPrice` less the discount. */
  price: number;
}

export type SeriesPurchaseStateResult =
  | {
      /**
       * The ids of the episodes of the series the reader owns for good: bought
       * on their own, in a volume, or with the rest of the series. A rental or
       * an access ticket opens an episode without owning it.
       */
      ownedEpisodeIds: ReadonlySet<string>;
      ok: true;
      /** `null` when the rest of the series is no sale to this reader. */
      remainder: SeriesRemainderQuote | null;
    }
  | { message: string; ok: false };

/** The generated `SeriesRemainderOffer` fields {@link toRemainderQuote} reads. */
type RawRemainderOffer = Pick<
  SeriesRemainderOffer,
  "discountPercent" | "episodeCount" | "listPrice" | "price"
>;

/**
 * An offer that would sell nothing, or for nothing, is no offer: the API never
 * answers one, and a button quoting zero episodes would be a lie if it did.
 */
const toRemainderQuote = (
  offer: RawRemainderOffer | undefined
): SeriesRemainderQuote | null => {
  const episodeCount = offer?.episodeCount ?? 0;
  const price = offer?.price ?? 0;

  if (episodeCount <= 0 || price <= 0) {
    return null;
  }

  return {
    discountPercent: offer?.discountPercent ?? 0,
    episodeCount,
    listPrice: offer?.listPrice ?? 0,
    price,
  };
};

const nothingToSell: SeriesPurchaseStateResult = {
  ok: true,
  ownedEpisodeIds: new Set(),
  remainder: null,
};

/**
 * What the reader owns of one series and what the rest of it would cost them:
 * the episodes they hold for good, which says whether a volume is already
 * theirs, and the quote for every episode left.
 *
 * A guest is asked about as well, without a session, and is quoted the whole
 * series as a reader who holds nothing; a session the API rejects is answered
 * the same way. A series taken down since the page was read sells nothing.
 *
 * Uncached. The purchase is recorded by the payment provider's notification
 * rather than by an Action this app runs, so there is no moment at which a
 * stored answer could be dropped, and a reader coming back from the checkout
 * has to be told what they now hold rather than offered it again.
 *
 * Memoized with React's request cache because every volume card and the
 * remainder offer read it from a `<Suspense>` of their own.
 */
export const getMySeriesPurchaseState = cache(
  async (
    tenantId: string,
    seriesId: string,
    locale: Locale
  ): Promise<SeriesPurchaseStateResult> => {
    const sessionId = await resolveAccessToken();

    try {
      const response = await apiClient.catalog.getSeriesEpisodeAccess(
        { seriesId, surface: ClientSurface.WEB, tenant: { tenantId } },
        sessionId ? buildSessionHeaders(sessionId) : undefined
      );

      return {
        ok: true,
        ownedEpisodeIds: new Set(
          (response.episodes ?? []).flatMap((episode) =>
            episode.owned && episode.episodeId ? [episode.episodeId] : []
          )
        ),
        remainder: toRemainderQuote(response.remainder),
      };
    } catch (error) {
      rethrowUnclassifiedRpcError(error);

      if (isMissingResourceRpcError(error)) {
        return nothingToSell;
      }

      const t = await getMessagesFor(locale);

      return {
        message: rpcErrorMessage(
          error,
          t("storefront.series.purchase_state_failed"),
          { locale }
        ),
        ok: false,
      };
    }
  }
);
