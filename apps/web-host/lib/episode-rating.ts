import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  isUnauthenticatedRpcError,
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
} from "@publira/api-client/errors";
import { EpisodeRatingMode } from "@publira/api-client/public/catalog";
import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import { applyCacheTag, tenantEpisodeRatingsTag } from "./cache-tags";
import { loadHostMessages } from "./messages";

/** The stored ceiling, and how many presses `multiple` mode will take. */
export const MAX_EPISODE_REACTION_SCORE = 5;

/** How the control takes a reaction: one press, or up to five. */
export type EpisodeReactionMode = "single" | "multiple";

export interface EpisodeReactionState {
  ratingCount: number;
  score: number;
}

/**
 * Tag the private reaction-status read carries, so `updateTag` in the Server
 * Action refreshes only this member's reaction island.
 */
export const episodeRatingsCacheTag = tenantEpisodeRatingsTag;

const ratingMessage = async (
  locale: Locale,
  key:
    | "errors.rpc.unauthenticated"
    | "host.episode.reaction.failed"
    | "host.episode.reaction.status_failed"
): Promise<string> => getMessage(await loadHostMessages(locale), key);

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

/**
 * What one press does to the control the reader is looking at. The count
 * moves only on the first press, because it is readers rather than presses.
 */
export const applyReactionPress = (
  current: EpisodeReactionState,
  mode: EpisodeReactionMode
): EpisodeReactionState => {
  if (current.score >= MAX_EPISODE_REACTION_SCORE) {
    return current;
  }
  return {
    ratingCount:
      current.score === 0 ? current.ratingCount + 1 : current.ratingCount,
    score: mode === "single" ? MAX_EPISODE_REACTION_SCORE : current.score + 1,
  };
};

/**
 * How far the heart is filled: empty until the first press, then the whole
 * heart in `single` mode, and `score / 5` in `multiple` mode.
 */
export const reactionFillRatio = (
  score: number,
  mode: EpisodeReactionMode
): number => {
  if (score <= 0) {
    return 0;
  }
  if (mode === "single") {
    return 1;
  }
  return (
    Math.min(score, MAX_EPISODE_REACTION_SCORE) / MAX_EPISODE_REACTION_SCORE
  );
};

export type EpisodeRatingStatusResult =
  | {
      mode: EpisodeReactionMode;
      ok: true;
      ratingCount: number;
      score: number;
      signedIn: boolean;
    }
  | { message: string; ok: false };

type CachedEpisodeRatingStatusResult = EpisodeRatingStatusResult & {
  unexpected: boolean;
};

const readMyEpisodeRating = async (
  tenantId: string,
  episodePublicId: string,
  locale: Locale
): Promise<CachedEpisodeRatingStatusResult> => {
  "use cache: private";
  applyCacheTag(episodeRatingsCacheTag(tenantId));

  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    return {
      mode: "single",
      ok: true,
      ratingCount: 0,
      score: 0,
      signedIn: false,
      unexpected: false,
    };
  }

  try {
    const response = await apiClient.rating.getMyEpisodeRating(
      {
        episodePublicId,
        tenant: { tenantId },
      },
      buildSessionHeaders(sessionId)
    );

    return {
      mode: toEpisodeReactionMode(response.mode),
      ok: true,
      ratingCount: toRatingCount(response.ratingCount),
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
        score: 0,
        signedIn: false,
        unexpected: false,
      };
    }
    return {
      message: rpcErrorMessage(
        error,
        await ratingMessage(locale, "host.episode.reaction.status_failed"),
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
  episodePublicId: string,
  locale: Locale
): Promise<EpisodeRatingStatusResult> => {
  const { unexpected, ...result } = await readMyEpisodeRating(
    tenantId,
    episodePublicId,
    locale
  );
  throwIfUnexpected(
    unexpected,
    result.ok
      ? await ratingMessage(locale, "host.episode.reaction.status_failed")
      : result.message
  );
  return result;
};

export const rateEpisode = async (input: {
  episodePublicId: string;
  locale: Locale;
  presses: number;
  tenantId: string;
}): Promise<
  | { mode: EpisodeReactionMode; ok: true; ratingCount: number; score: number }
  | { message: string; ok: false }
> => {
  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    return {
      message: await ratingMessage(input.locale, "errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  try {
    const response = await apiClient.rating.rateEpisode(
      {
        episodePublicId: input.episodePublicId,
        presses: input.presses,
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
      message: rpcErrorMessage(
        error,
        await ratingMessage(input.locale, "host.episode.reaction.failed"),
        { locale: input.locale }
      ),
      ok: false,
    };
  }
};
