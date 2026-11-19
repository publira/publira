import { describe, expect, it } from "vitest";

import {
  MAX_SERIES_FREE_WINDOW_EPISODES,
  freeWindowEpisodes,
} from "./free-window-target";

const episodes = Array.from({ length: 5 }, (_, index) => ({
  id: `EP${String(index + 1).padStart(2, "0")}`,
}));

describe("freeWindowEpisodes", () => {
  it("names the checked episodes in reading order, not in check order", () => {
    expect(
      freeWindowEpisodes(episodes, {
        episodeIds: ["EP04", "EP02"],
        target: "selected",
      })
    ).toEqual({ count: 2, episodeIds: ["EP02", "EP04"], ok: true });
  });

  it("drops a checked episode the series no longer has", () => {
    expect(
      freeWindowEpisodes(episodes, {
        episodeIds: ["EP01", "GONE"],
        target: "selected",
      })
    ).toEqual({ count: 1, episodeIds: ["EP01"], ok: true });
  });

  it("names the first episodes of the series", () => {
    expect(
      freeWindowEpisodes(episodes, { firstCount: 3, target: "first" })
    ).toEqual({
      count: 3,
      episodeIds: ["EP01", "EP02", "EP03"],
      ok: true,
    });
  });

  it("covers the episodes there are when the count is larger than the series", () => {
    expect(
      freeWindowEpisodes(episodes, { firstCount: 9, target: "first" })
    ).toEqual({
      count: 5,
      episodeIds: ["EP01", "EP02", "EP03", "EP04", "EP05"],
      ok: true,
    });
  });

  it("names no episode for the whole series, and counts it", () => {
    expect(freeWindowEpisodes(episodes, { target: "all" })).toEqual({
      count: 5,
      episodeIds: undefined,
      ok: true,
    });
  });

  it("reports a series with no episodes, whatever the target", () => {
    expect(freeWindowEpisodes([], { target: "all" })).toEqual({
      ok: false,
      reason: "empty",
    });
    expect(freeWindowEpisodes([], { firstCount: 3, target: "first" })).toEqual({
      ok: false,
      reason: "empty",
    });
    expect(
      freeWindowEpisodes(episodes, { episodeIds: [], target: "selected" })
    ).toEqual({ ok: false, reason: "empty" });
  });

  it("refuses more named episodes than one call takes", () => {
    const many = Array.from(
      { length: MAX_SERIES_FREE_WINDOW_EPISODES + 1 },
      (_, index) => ({ id: `EP${index}` })
    );

    expect(
      freeWindowEpisodes(many, {
        firstCount: MAX_SERIES_FREE_WINDOW_EPISODES + 1,
        target: "first",
      })
    ).toEqual({ ok: false, reason: "too-many" });
    expect(freeWindowEpisodes(many, { target: "all" })).toMatchObject({
      count: MAX_SERIES_FREE_WINDOW_EPISODES + 1,
      ok: true,
    });
  });
});
