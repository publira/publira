import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  isUnauthenticatedRpcError,
  RPC_ERROR_REASON,
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
  rpcErrorHasReason,
} from "@publira/api-client/errors";
import { EpisodeRatingMode } from "@publira/api-client/public/catalog";
import { ClientSurface } from "@publira/api-client/public/types";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import { applyCacheTag, tenantEpisodeRatingsTag } from "./cache-tags";
import type { EpisodeReactionMode } from "./episode-rating-state";
import { MAX_EPISODE_REACTION_SCORE } from "./episode-rating-state";
import { getMessagesFor } from "./messages";

export {
  applyReactionPress,
  MAX_EPISODE_REACTION_SCORE,
  reactionFillRatio,
} from "./episode-rating-state";
export type {
  EpisodeReactionMode,
  EpisodeReactionState,
} from "./episode-rating-state";

/**
 * Tag the private reaction-status read carries, so `updateTag` in the Server
 * Action refreshes only this member's reaction island.
 */
export const episodeRatingsCacheTag = tenantEpisodeRatingsTag;

const isUnexpectedError = (error: unknown): boolean =>
  rpcErrorDisposition(error) === "unexpected";

const throwIfUnexpected = (unexpected: boolean, message: string): void => {
  if (unexpected) {
    throw new Error(message);
  }
};

const toScore = (score: number | undefined): number => {
  if (score === undefined || score < 0) {
    return 0;
  }
  return Math.min(score, MAX_EPISODE_REACTION_SCORE);
};

const toRatingCount = (ratingCount: bigint | number | undefined): number => {
  const count = Number(ratingCount ?? 0);
  return Number.isFinite(count) && count > 0 ? count : 0;
};

export const toEpisodeReactionMode = (
  mode?: EpisodeRatingMode | number
): EpisodeReactionMode =>
  mode === EpisodeRatingMode.MULTIPLE ? "multiple" : "single";

export type EpisodeRatingStatusResult =
  | {
      mode: EpisodeReactionMode;
      ok: true;
      ratingCount: number;
      /**
       * The reader is credited on the episode, which the API refuses a rating
       * from, so the control is not offered.
       */
      readerCredited: boolean;
      score: number;
      signedIn: boolean;
    }
  | { message: string; ok: false };

type CachedEpisodeRatingStatusResult = EpisodeRatingStatusResult & {
  unexpected: boolean;
};

const readMyEpisodeRating = async (
  tenantId: string,
  episodeId: string,
  locale: Locale,
  sessionId: string
): Promise<CachedEpisodeRatingStatusResult> => {
  "use cache: private";
  applyCacheTag(episodeRatingsCacheTag(tenantId));

  if (!sessionId) {
    return {
      mode: "single",
      ok: true,
      ratingCount: 0,
      readerCredited: false,
      score: 0,
      signedIn: false,
      unexpected: false,
    };
  }

  const t = await getMessagesFor(locale);

  try {
    const response = await apiClient.rating.getMyEpisodeRating(
      {
        episodeId,
        surface: ClientSurface.WEB,
        tenant: { tenantId },
      },
      buildSessionHeaders(sessionId)
    );

    return {
      mode: toEpisodeReactionMode(response.mode),
      ok: true,
      ratingCount: toRatingCount(response.ratingCount),
      readerCredited: response.readerCredited ?? false,
      score: toScore(response.score),
      signedIn: true,
      unexpected: false,
    };
  } catch (error) {
    dropFailedCacheEntry();
    if (isUnauthenticatedRpcError(error)) {
      return {
        mode: "single",
        ok: true,
        ratingCount: 0,
        readerCredited: false,
        score: 0,
        signedIn: false,
        unexpected: false,
      };
    }
    return {
      message: rpcErrorMessage(
        error,
        t("host.episode.reaction.status_failed"),
        { locale }
      ),
      ok: false,
      unexpected: isUnexpectedError(error),
    };
  }
};

/**
 * The current member's reaction to one published episode, and which press
 * mode governs the control.
 *
 * Guests skip the RPC: no session means "not signed in", which the island
 * turns into a login link. A rejected session is treated the same way so a
 * stale cookie does not personalize — or fail — the surrounding public page.
 *
 * The public headcount the caller already has from the cached episode read
 * is what a guest sees; this read's `ratingCount` is only used once the
 * reader is signed in, where it is the uncached tally next to their score.
 */
export const getMyEpisodeRating = async (
  tenantId: string,
  episodeId: string,
  locale: Locale
): Promise<EpisodeRatingStatusResult> => {
  const [{ unexpected, ...result }, t] = await Promise.all([
    readMyEpisodeRating(
      tenantId,
      episodeId,
      locale,
      await resolveAccessToken()
    ),
    getMessagesFor(locale),
  ]);
  throwIfUnexpected(
    unexpected,
    result.ok ? t("host.episode.reaction.status_failed") : result.message
  );
  return result;
};

export const rateEpisode = async (input: {
  episodeId: string;
  locale: Locale;
  presses: number;
  tenantId: string;
}): Promise<
  | { mode: EpisodeReactionMode; ok: true; ratingCount: number; score: number }
  | { message: string; ok: false }
> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(input.locale),
    resolveAccessToken(),
  ]);
  if (!sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  try {
    const response = await apiClient.rating.rateEpisode(
      {
        episodeId: input.episodeId,
        presses: input.presses,
        surface: ClientSurface.WEB,
        tenant: { tenantId: input.tenantId },
      },
      buildSessionHeaders(sessionId)
    );
    return {
      mode: toEpisodeReactionMode(response.mode),
      ok: true,
      ratingCount: toRatingCount(response.ratingCount),
      score: toScore(response.score),
    };
  } catch (error) {
    if (isUnauthenticatedRpcError(error)) {
      throw error;
    }
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(error, t("host.episode.reaction.failed"), {
        locale: input.locale,
        overrides: {
          forbidden: rpcErrorHasReason(
            error,
            RPC_ERROR_REASON.readerCreditedOnEpisode
          )
            ? t("host.episode.reaction.reader_credited")
            : undefined,
        },
      }),
      ok: false,
    };
  }
};
