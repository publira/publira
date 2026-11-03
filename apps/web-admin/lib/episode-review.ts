import type {
  Episode,
  EpisodeReviewRound,
} from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
} from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheTag } from "next/cache";

import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import type { CachedRead } from "./cached-read";
import { settleCachedRead } from "./cached-read";
import { episodeCacheTag, episodesCacheTag } from "./episode";
import type { EpisodeReviewStateValue } from "./episode-review-state";
import { toEpisodeReviewStateValue } from "./episode-review-state-enum";
import { getMessagesFor } from "./messages";
import { getAccessToken } from "./session";

/** One round of an episode's review: who submitted it, and what came of it. */
export interface EpisodeReviewRoundItem {
  id: string;
  submittedAt: string;
  /** Empty for an account deleted since. */
  submittedByName: string;
  /** `in_review` while the round waits for a decision, else the decision. */
  state: EpisodeReviewStateValue;
  /** Empty while the round is in review. */
  decidedAt: string;
  /** Empty while the round is in review, and for an account deleted since. */
  decidedByName: string;
  comment: string;
}

export type ListEpisodeReviewsResult =
  | { ok: true; rounds: EpisodeReviewRoundItem[] }
  | {
      ok: false;
      message: string;
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn: boolean;
    };

/** What a submission, an approval, or a return leaves of the episode. */
export type DecideEpisodeReviewResult =
  | { ok: true }
  | { ok: false; message: string };

/** The generated `EpisodeReviewRound` fields {@link mapRound} reads (see `series.ts`). */
type RawEpisodeReviewRound = Pick<
  EpisodeReviewRound,
  | "comment"
  | "decidedAt"
  | "decidedByName"
  | "id"
  | "state"
  | "submittedAt"
  | "submittedByName"
>;

/**
 * A round in a state this build does not know is left out rather than shown
 * as one waiting for a decision nobody can make.
 */
const mapRound = (
  round: RawEpisodeReviewRound
): EpisodeReviewRoundItem | undefined => {
  const state = toEpisodeReviewStateValue(round.state);

  if (!state) {
    return;
  }

  return {
    comment: round.comment ?? "",
    decidedAt: round.decidedAt ?? "",
    decidedByName: round.decidedByName ?? "",
    id: round.id,
    state,
    submittedAt: round.submittedAt ?? "",
    submittedByName: round.submittedByName ?? "",
  };
};

/**
 * Every write to an episode can open a round — a time saved, an approval
 * taken back by an edit — and every such write clears the episode tags, so the
 * rounds are filed under them rather than under a tag of their own.
 */
const listEpisodeReviewsForSession = async (
  input: { tenantId: string; episodeId: string },
  locale: Locale,
  sessionId: string
): Promise<CachedRead<ListEpisodeReviewsResult>> => {
  "use cache: private";
  cacheTag(episodesCacheTag(input.tenantId));
  cacheTag(episodeCacheTag(input.tenantId, input.episodeId));

  const t = await getMessagesFor(locale);

  if (!sessionId) {
    dropFailedCacheEntry();

    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: true,
    };
  }

  try {
    const response = await apiClient.series.listEpisodeReviews(
      {
        episodeId: input.episodeId,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      ok: true,
      rounds: (response.rounds ?? []).flatMap((round) => {
        const mapped = mapRound(round);

        return mapped ? [mapped] : [];
      }),
    };
  } catch (error) {
    dropFailedCacheEntry();

    return {
      message: rpcErrorMessage(
        error,
        t("admin.series.episodes.review.list_failed"),
        { locale }
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
      unexpected: rpcErrorDisposition(error) === "unexpected",
    };
  }
};

/** The episode's rounds of review, oldest first. */
export const listEpisodeReviews = async (
  input: { tenantId: string; episodeId: string },
  locale: Locale
): Promise<ListEpisodeReviewsResult> =>
  settleCachedRead(
    await listEpisodeReviewsForSession(input, locale, await getAccessToken())
  );

/**
 * The failure of a review write. A failed precondition is the episode having
 * moved on since the screen was read — submitted, decided, published, or the
 * tenant having stopped requiring review — which a reload shows.
 */
const mapReviewErrorToMessage = async (
  cause: unknown,
  fallbackMessage: string,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);

  return rpcErrorMessage(cause, fallbackMessage, {
    locale,
    overrides: {
      "not-found": t("admin.series.episodes.review.episode_not_found"),
      precondition: t("admin.series.episodes.review.state_changed"),
    },
  });
};

/** Runs one review write with the operator's session, and words its failure. */
const writeEpisodeReview = async (
  locale: Locale,
  fallbackKey:
    | "admin.series.episodes.review.approve_failed"
    | "admin.series.episodes.review.return_failed"
    | "admin.series.episodes.review.submit_failed",
  write: (sessionId: string) => Promise<{ episode?: Episode }>
): Promise<DecideEpisodeReviewResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    await write(sessionId);

    return { ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: await mapReviewErrorToMessage(error, t(fallbackKey), locale),
      ok: false,
    };
  }
};

/** Submits an episode for review again without moving its time. */
export const submitEpisodeForReview = (
  input: { tenantId: string; episodeId: string },
  locale: Locale
): Promise<DecideEpisodeReviewResult> =>
  writeEpisodeReview(
    locale,
    "admin.series.episodes.review.submit_failed",
    (sessionId) =>
      apiClient.series.submitEpisodeForReview(
        { episodeId: input.episodeId, tenant: { tenantId: input.tenantId } },
        withSessionHeaders(sessionId)
      )
  );

/** Approves the open round, with an optional comment. */
export const approveEpisode = (
  input: { tenantId: string; episodeId: string; comment: string },
  locale: Locale
): Promise<DecideEpisodeReviewResult> =>
  writeEpisodeReview(
    locale,
    "admin.series.episodes.review.approve_failed",
    (sessionId) =>
      apiClient.series.approveEpisode(
        {
          comment: input.comment,
          episodeId: input.episodeId,
          tenant: { tenantId: input.tenantId },
        },
        withSessionHeaders(sessionId)
      )
  );

/** Sends the open round back to whoever submitted it, saying what to fix. */
export const returnEpisode = (
  input: { tenantId: string; episodeId: string; comment: string },
  locale: Locale
): Promise<DecideEpisodeReviewResult> =>
  writeEpisodeReview(
    locale,
    "admin.series.episodes.review.return_failed",
    (sessionId) =>
      apiClient.series.returnEpisode(
        {
          comment: input.comment,
          episodeId: input.episodeId,
          tenant: { tenantId: input.tenantId },
        },
        withSessionHeaders(sessionId)
      )
  );
