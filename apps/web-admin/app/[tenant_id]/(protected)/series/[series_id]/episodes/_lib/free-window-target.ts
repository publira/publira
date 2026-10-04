import { episodesSelectedInReadingOrder } from "./credit-range";

/** Which episodes of the series the bulk action makes free. */
export const FREE_WINDOW_TARGETS = ["selected", "first", "all"] as const;

export type FreeWindowTarget = (typeof FREE_WINDOW_TARGETS)[number];

/**
 * The most episodes `CreateSeriesFreeWindows` takes by name. Every episode of
 * the series is scheduled without naming any, so the bound reaches only the
 * selection and the first episodes.
 */
export const MAX_SERIES_FREE_WINDOW_EPISODES = 1000;

export type FreeWindowEpisodes =
  | {
      ok: true;
      /** The episodes to name, or `undefined` for every episode of the series. */
      episodeIds: string[] | undefined;
      count: number;
    }
  | { ok: false; reason: "empty" | "too-many" };

/**
 * The episodes a bulk free window covers, resolved against the series' own
 * episodes in reading order.
 *
 * The first episodes are counted here rather than sent as a count, for the
 * reason the credits range is: a reorder between composing the request and
 * running it would otherwise make a different set of episodes free. A count
 * larger than the series covers the episodes there are.
 */
export const freeWindowEpisodes = <T extends { id: string }>(
  episodes: readonly T[],
  target:
    | { target: "selected"; episodeIds: readonly string[] }
    | { target: "first"; firstCount: number }
    | { target: "all" }
): FreeWindowEpisodes => {
  if (target.target === "all") {
    return episodes.length === 0
      ? { ok: false, reason: "empty" }
      : { count: episodes.length, episodeIds: undefined, ok: true };
  }

  const covered =
    target.target === "first"
      ? episodes.slice(0, target.firstCount)
      : episodesSelectedInReadingOrder(episodes, target.episodeIds);
  if (covered.length === 0) {
    return { ok: false, reason: "empty" };
  }
  if (covered.length > MAX_SERIES_FREE_WINDOW_EPISODES) {
    return { ok: false, reason: "too-many" };
  }

  return {
    count: covered.length,
    episodeIds: covered.map((episode) => episode.id),
    ok: true,
  };
};
