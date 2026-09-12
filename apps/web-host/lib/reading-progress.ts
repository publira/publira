import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  isUnauthenticatedRpcError,
  rethrowUnclassifiedRpcError,
} from "@publira/api-client/errors";
import type {
  RecentSeries,
  SeriesProgress,
} from "@publira/api-client/public/types";
import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { cache } from "react";

import type { RestrictedAgeRating } from "./age-rating";
import { withRestrictedAgeRating } from "./age-rating";
import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import { toEyeCatchImageVariants } from "./catalog";
import type { EyeCatchImageVariant } from "./catalog";
import { loadHostMessages } from "./messages";

const defaultRecentSeriesLimit = 20;

/**
 * The episode an offer points at, in the shape both surfaces render it: the
 * number the series page prints beside a title, and the title itself.
 */
export interface ReadingProgressEpisode {
  orderIndex: number;
  publicId: string;
  title: string;
}

export interface RecentSeriesItem {
  episode: ReadingProgressEpisode;
  series: {
    ageRating?: RestrictedAgeRating;
    eyeCatchImageVariants?: EyeCatchImageVariant[];
    publicId: string;
    title: string;
  };
}

export type ListMyRecentSeriesResult =
  | { ok: true; series: RecentSeriesItem[] }
  | { message: string; ok: false };

export interface SeriesProgressItem {
  episode: ReadingProgressEpisode;
  /** The reader already finished {@link SeriesProgressItem.episode}. */
  isFinished: boolean;
}

export type SeriesProgressResult =
  | {
      /**
       * The episodes of this series the reader has finished. Independent of
       * `progress`: finishing an episode and saving a position in it are two
       * different writes, so a reader can have one without the other.
       */
      finishedEpisodePublicIds: string[];
      ok: true;
      progress: SeriesProgressItem | null;
      signedIn: boolean;
    }
  | { message: string; ok: false };

export interface ListMyRecentSeriesInput {
  limit?: number;
  /** UI locale the failure wording is written in. */
  locale: Locale;
}

/**
 * The generated fields the mappers below read. Naming them against the message
 * types is what makes a proto rename fail here — a restated structural type
 * keeps compiling, and the offer then points at an empty episode ID with
 * nothing naming the cause.
 */
type RawRecentSeries = Pick<RecentSeries, "episode" | "series">;
type RawSeriesProgress = Pick<SeriesProgress, "episode" | "isFinished">;

const mapEpisode = (
  episode: RawRecentSeries["episode"]
): ReadingProgressEpisode | null => {
  const publicId = episode?.publicId?.trim() ?? "";
  if (!publicId) {
    return null;
  }
  return {
    orderIndex: episode?.orderIndex ?? 0,
    publicId,
    title: episode?.title ?? "",
  };
};

const mapRecentSeries = (item: RawRecentSeries): RecentSeriesItem | null => {
  const episode = mapEpisode(item.episode);
  const seriesPublicId = item.series?.publicId?.trim() ?? "";
  if (!(episode && seriesPublicId)) {
    return null;
  }
  return {
    episode,
    series: withRestrictedAgeRating(
      {
        eyeCatchImageVariants: toEyeCatchImageVariants(
          item.series?.eyeCatchImageVariants
        ),
        publicId: seriesPublicId,
        title: item.series?.title ?? "",
      },
      item.series?.ageRating
    ),
  };
};

const mapSeriesProgress = (
  progress: RawSeriesProgress | undefined
): SeriesProgressItem | null => {
  if (!progress) {
    return null;
  }
  const episode = mapEpisode(progress.episode);
  if (!episode) {
    return null;
  }
  return { episode, isFinished: progress.isFinished ?? false };
};

/**
 * The series the signed-in reader was in the middle of, newest activity first,
 * each with the episode to open next.
 *
 * Uncached, the way the per-episode position is. What changes the answer is
 * written by the viewer's beacons rather than by a Server Action on the page
 * that shows it, so there is no moment at which a stored entry could be
 * dropped; a reused one would go on offering the episode the reader has just
 * finished.
 *
 * A guest is an empty list rather than a failure — the row is theirs not to
 * see — and a session the API rejects says the same thing as no session at
 * all. Anything else is carried back as a message, so the row can report that
 * it could not be built without taking the rest of the home page with it.
 */
export const listMyRecentSeries = async (
  tenantId: string,
  input: ListMyRecentSeriesInput
): Promise<ListMyRecentSeriesResult> => {
  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    return { ok: true, series: [] };
  }

  try {
    const response = await apiClient.episodeRead.listMyRecentSeries(
      {
        limit: input.limit ?? defaultRecentSeriesLimit,
        tenant: { tenantId },
        token: "",
      },
      buildSessionHeaders(sessionId)
    );
    return {
      ok: true,
      series: (response.series ?? []).flatMap((item) => {
        const mapped = mapRecentSeries(item);
        return mapped ? [mapped] : [];
      }),
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    if (isUnauthenticatedRpcError(error)) {
      return { ok: true, series: [] };
    }
    const messages = await loadHostMessages(input.locale);
    return {
      message: rpcErrorMessage(
        error,
        getMessage(messages, "host.top.continue_failed"),
        { locale: input.locale }
      ),
      ok: false,
    };
  }
};

/**
 * Where the signed-in reader stands in one series: the episode they last moved
 * in and whether they finished it, plus every episode of the series they have
 * already finished.
 *
 * Uncached for the reason {@link listMyRecentSeries} is. `signedIn` is part of
 * the answer because the two empty cases are different offers: a member with no
 * history is invited into the first episode, while a guest is offered nothing
 * and sees the series page a signed-out reader has always seen.
 *
 * Memoized with React's request cache because the series page reads it from two
 * places that cannot share a value any other way — the call to action above the
 * episode list, and the read marker on each row of that list, each inside its
 * own `<Suspense>` so neither holds the page up. Both want the same answer for
 * the same request, and the memo is what keeps that one RPC.
 */
export const getMySeriesProgress = cache(
  async (
    tenantId: string,
    seriesPublicId: string,
    locale: Locale
  ): Promise<SeriesProgressResult> => {
    const sessionId = await resolveAccessToken();
    if (!sessionId) {
      return {
        finishedEpisodePublicIds: [],
        ok: true,
        progress: null,
        signedIn: false,
      };
    }

    try {
      const response = await apiClient.episodeRead.getMySeriesProgress(
        { seriesPublicId, tenant: { tenantId } },
        buildSessionHeaders(sessionId)
      );
      return {
        finishedEpisodePublicIds: response.finishedEpisodePublicIds ?? [],
        ok: true,
        progress: mapSeriesProgress(response.progress),
        signedIn: true,
      };
    } catch (error) {
      rethrowUnclassifiedRpcError(error);
      if (isUnauthenticatedRpcError(error)) {
        return {
          finishedEpisodePublicIds: [],
          ok: true,
          progress: null,
          signedIn: false,
        };
      }
      const messages = await loadHostMessages(locale);
      return {
        message: rpcErrorMessage(
          error,
          getMessage(messages, "host.series.progress_failed"),
          { locale }
        ),
        ok: false,
      };
    }
  }
);
