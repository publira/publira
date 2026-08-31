import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";

export interface EpisodeRead {
  publicId: string;
  tenantId: string;
}

/**
 * Record that the signed-in member finished reading one episode.
 *
 * A guest is left alone: reaching the last page is not a request to sign in,
 * and there is no anonymous read state to write. The beacon that carries this
 * is sent by every reader who finishes, because the viewer sits in the static
 * shell and cannot ask who is reading without taking it out of there; the
 * session is resolved here instead, where it is authoritative at write time.
 *
 * Whether the write is allowed at all stays with the API, which re-checks
 * publication and paid-body access on the write itself and answers `NotFound`
 * otherwise. It also owns idempotency: a re-read never writes a second row and
 * never moves the first timestamp.
 *
 * Nothing is reported back. The beacon's response is not read by the browser,
 * so an episode that has since been unpublished, an entitlement that has run
 * out, or a session the API rejected are all simply the end of this request.
 * A failure that cannot be classified still propagates, so the Route Handler
 * fails loudly enough to appear in the logs.
 */
export const recordEpisodeRead = async ({
  publicId,
  tenantId,
}: EpisodeRead): Promise<void> => {
  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    return;
  }

  try {
    await apiClient.episodeRead.markEpisodeAsRead(
      { episodePublicId: publicId, tenant: { tenantId } },
      buildSessionHeaders(sessionId)
    );
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
  }
};
