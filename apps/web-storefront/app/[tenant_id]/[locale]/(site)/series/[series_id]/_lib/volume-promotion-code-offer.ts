import { isUnauthenticatedRpcError } from "@publira/api-client/errors";

import {
  NO_PROMOTION_CODE,
  PROMOTION_CODE_MAX_SALES,
} from "#lib/promotion-code";
import type { PromotionCodeState } from "#lib/promotion-code";
import { quoteVolumePromotionCode } from "#lib/promotion-code-quote";

/**
 * The volumes a code is quoted against: those on sale to the reader, up to the
 * most one lookup quotes. A volume past that keeps its price.
 */
export const quotableVolumeIds = (
  volumes: readonly { episodeIds: string[]; id: string }[],
  ownedEpisodeIds: ReadonlySet<string>
): string[] =>
  volumes
    .filter(
      ({ episodeIds }) =>
        episodeIds.length === 0 ||
        !episodeIds.every((id) => ownedEpisodeIds.has(id))
    )
    .slice(0, PROMOTION_CODE_MAX_SALES)
    .map(({ id }) => id);

/**
 * What the volumes section's code field starts from: the code the URL carried,
 * quoted against `volumeIds`, or no code.
 *
 * A session that expired since the page read what the reader owns leaves the
 * field empty rather than failing the page: the checkout sends the reader to
 * sign in again anyway.
 */
export const toVolumePromotionCodeOffer = async ({
  code,
  sessionId,
  tenantId,
  volumeIds,
}: {
  /** The `promotion_code` search parameter, empty where the URL has none. */
  code: string;
  sessionId: string;
  tenantId: string;
  volumeIds: readonly string[];
}): Promise<PromotionCodeState<string>> => {
  if (!code) {
    return NO_PROMOTION_CODE;
  }

  try {
    return await quoteVolumePromotionCode({
      code,
      sessionId,
      tenantId,
      volumeIds,
    });
  } catch (error) {
    if (isUnauthenticatedRpcError(error)) {
      return NO_PROMOTION_CODE;
    }

    throw error;
  }
};
