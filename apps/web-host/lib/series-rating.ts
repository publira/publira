import { isUnauthenticatedRpcError } from "@publira/api-client/errors";
import { ClientSurface } from "@publira/api-client/public/types";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";

/** Read only within the member's Suspense island, outside the public cache. */
export const getMySeriesRating = async (
  tenantId: string,
  seriesPublicId: string
) => {
  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    return null;
  }
  try {
    const response = await apiClient.rating.getMySeriesRating(
      { seriesPublicId, surface: ClientSurface.WEB, tenant: { tenantId } },
      buildSessionHeaders(sessionId)
    );
    return response.ratedEpisodeCount > 0 ? response.ratingAverage : null;
  } catch (error) {
    if (isUnauthenticatedRpcError(error)) {
      return null;
    }
    throw error;
  }
};
