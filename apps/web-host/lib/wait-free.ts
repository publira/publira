import {
  isExpectedNullableRpcError,
  RPC_ERROR_REASON,
  rpcErrorHasReason,
} from "@publira/api-client/errors";
import { ClientSurface } from "@publira/api-client/public/types";
import type { Locale } from "@publira/i18n";
import type { CachedReadResult } from "@publira/utils/cached-read";
import { cacheLife } from "next/cache";

import { apiClient, buildSessionHeaders } from "./api-client";
import { applyCacheTag, tenantReaderAccessTag } from "./cache-tags";
import { localizedReadFailure } from "./read-failure";

/**
 * Whether the reader's wait-for-free ticket on a series is ready, and when it
 * will be when it is not.
 */
export type WaitFreeTicketState =
  | { ready: true }
  | {
      /** RFC3339 instant the next ticket is ready. */
      nextAvailableAt: string;
      ready: false;
    };

/**
 * The signed-in reader's wait-for-free ticket on one series.
 *
 * `ok: true` with a `null` value when there is nothing to offer this reader: no
 * session, a session the API rejects, a series it no longer shows, or a rule
 * an editor turned off after the series page was cached. The gate then shows
 * no ticket at all, which is what it shows on a series without the rule.
 *
 * `accessToken` is an argument for the reason `getEpisodeViewer` gives, and
 * the entry carries {@link tenantReaderAccessTag} so the Action that spends the
 * ticket drops it together with the episode body it opened.
 */
export const getMyWaitFreeTicketState = async (
  tenantId: string,
  seriesId: string,
  accessToken: string,
  locale: Locale
): Promise<CachedReadResult<WaitFreeTicketState | null>> => {
  "use cache: private";
  try {
    cacheLife({ stale: 30 });
  } catch {
    // Unit tests run without the Next.js cache runtime, same as applyCacheTag.
  }

  const normalizedTenantId = tenantId.trim();
  applyCacheTag(tenantReaderAccessTag(normalizedTenantId));

  const sessionId = accessToken.trim();
  if (!sessionId) {
    return { ok: true, value: null };
  }

  let response;
  try {
    response = await apiClient.waitFree.getMyTicketState(
      {
        seriesId: seriesId.trim(),
        surface: ClientSurface.WEB,
        tenant: { tenantId: normalizedTenantId },
      },
      buildSessionHeaders(sessionId)
    );
  } catch (error) {
    if (
      isExpectedNullableRpcError(error) ||
      rpcErrorHasReason(error, RPC_ERROR_REASON.waitFreeNotOffered)
    ) {
      return { ok: true, value: null };
    }
    return localizedReadFailure(
      error,
      locale,
      "host.episode.gate.wait_free_state_failed"
    );
  }

  const nextAvailableAt = response.nextAvailableAt?.trim() ?? "";
  return {
    ok: true,
    value: nextAvailableAt
      ? { nextAvailableAt, ready: false }
      : { ready: true },
  };
};
