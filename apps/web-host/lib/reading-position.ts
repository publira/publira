import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";

export interface ReadingPositionTarget {
  episodePublicId: string;
  tenantId: string;
}

export interface ReadingPositionRead extends ReadingPositionTarget {
  accessToken: string;
}

export interface ReadingPositionSave extends ReadingPositionTarget {
  /** Zero-based, counted over the episode's pages in reading order. */
  pageIndex: number;
}

/**
 * Where the signed-in member stopped in one episode, or `null` when they have
 * no position in it.
 *
 * Uncached on purpose. The viewer this answer opens is also what writes the
 * next one, so any window in which the answer is reused is a window in which
 * it is wrong: a reader who leaves the episode and comes back to it without a
 * page load would be sent to the page they had already left. The reader's own
 * comments on the same route are read the same way, and for the same reason.
 *
 * A guest has no position and never reaches the API. Neither does a member who
 * may no longer read the body: the API answers them like a member who never
 * opened the episode, so the viewer starts at the first page either way and
 * the empty answer says nothing about what the tenant holds.
 *
 * `accessToken` is an argument because the caller renders both the position
 * and the recorder that writes the next one from the same session, and
 * resolves it once for both.
 */
export const getMyReadingPosition = async ({
  accessToken,
  episodePublicId,
  tenantId,
}: ReadingPositionRead): Promise<number | null> => {
  const sessionId = accessToken.trim();
  if (!sessionId) {
    return null;
  }

  try {
    const response = await apiClient.episodeRead.getMyReadingPosition(
      { episodePublicId, tenant: { tenantId } },
      buildSessionHeaders(sessionId)
    );
    return response.position?.pageIndex ?? null;
  } catch (error) {
    // The position is an improvement on opening at the first page, never the
    // reason the episode is unreadable, so a classified failure leaves the
    // reader at the first page rather than replacing the body with an error.
    rethrowUnclassifiedRpcError(error);
    return null;
  }
};

/**
 * Record where the signed-in member stopped in one episode.
 *
 * A guest is left alone: there is no anonymous read state to write, and the
 * beacon that carries this is sent by every reader who turns a page, because
 * the viewer cannot ask who is reading without waiting on the session. The
 * session is resolved here instead, where it is authoritative at write time.
 *
 * Nothing is reported back. The beacon's response is not read by the browser,
 * so an episode unpublished since it was opened, an entitlement that ran out
 * while it was open, and a page the episode no longer has are all simply the
 * end of this request. A failure that cannot be classified still propagates,
 * so the Route Handler fails loudly enough to appear in the logs.
 */
export const saveReadingPosition = async ({
  episodePublicId,
  pageIndex,
  tenantId,
}: ReadingPositionSave): Promise<void> => {
  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    return;
  }

  try {
    await apiClient.episodeRead.saveReadingPosition(
      { episodePublicId, pageIndex, tenant: { tenantId } },
      buildSessionHeaders(sessionId)
    );
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
  }
};
