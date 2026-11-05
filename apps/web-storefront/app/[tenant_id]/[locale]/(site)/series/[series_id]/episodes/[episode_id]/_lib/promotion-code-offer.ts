import { isUnauthenticatedRpcError } from "@publira/api-client/errors";

import {
  episodeSaleDestination,
  toTenantSaleChannels,
} from "#lib/app-payments";
import type { TenantAppPayments } from "#lib/app-payments";
import type { EpisodeDetail } from "#lib/catalog";
import { episodeSaleKinds, NO_PROMOTION_CODE } from "#lib/promotion-code";
import type { EpisodeSaleKind, PromotionCodeState } from "#lib/promotion-code";
import { quoteEpisodePromotionCode } from "#lib/promotion-code-quote";

/**
 * What the gate's promotion code field starts from for a signed-in reader:
 * the code the URL carried, quoted against each sale the gate's buttons
 * offer, or no code. Absent where the gate offers no field: on a tenant that
 * holds no code a reader could enter, and on an episode the site does not
 * sell, whose gate has no checkout button for a code to rewrite.
 *
 * A session that expired since the page read the reader's access leaves the
 * field empty rather than failing the gate: the checkout sends the reader to
 * sign in again anyway.
 */
export const toPromotionCodeOffer = async ({
  acceptsPayments,
  acceptsPromotionCodes,
  appPayments,
  code,
  episode,
  sessionId,
  tenantId,
}: {
  acceptsPayments: boolean;
  acceptsPromotionCodes: boolean;
  appPayments: TenantAppPayments;
  /** The `promotion_code` search parameter, empty where the URL has none. */
  code: string;
  episode: Pick<
    EpisodeDetail,
    "id" | "purchaseSurface" | "rentalPeriodHours" | "rentalPrice"
  >;
  sessionId: string;
  tenantId: string;
}): Promise<PromotionCodeState<EpisodeSaleKind> | undefined> => {
  const destination = episodeSaleDestination(
    episode.purchaseSurface,
    toTenantSaleChannels({ acceptsPayments, appPayments })
  );

  if (!acceptsPromotionCodes || destination !== "web") {
    return undefined;
  }

  if (!code) {
    return NO_PROMOTION_CODE;
  }

  try {
    return await quoteEpisodePromotionCode({
      code,
      episodeId: episode.id,
      kinds: episodeSaleKinds(episode),
      sessionId,
      tenantId,
    });
  } catch (error) {
    if (isUnauthenticatedRpcError(error)) {
      return NO_PROMOTION_CODE;
    }

    throw error;
  }
};
