import { describe, expect, it } from "vitest";

import {
  MAX_BULK_EPISODE_CREDIT_EPISODES,
  episodesSelectedInReadingOrder,
} from "./credit-range";

const episodes = Array.from({ length: 40 }, (_, index) => ({
  publicId: `EP${String(index + 1).padStart(2, "0")}`,
  title: `Episode ${index + 1}`,
}));

describe("episodesSelectedInReadingOrder", () => {
  it("keeps episodes 1–11 of a 40-episode series and nothing after episode 11", () => {
    const selected = episodesSelectedInReadingOrder(
      episodes,
      episodes.slice(0, 11).map((episode) => episode.publicId)
    );

    expect(selected).toHaveLength(11);
    expect(selected.at(0)?.publicId).toBe("EP01");
    expect(selected.at(-1)?.publicId).toBe("EP11");
    expect(selected.some((episode) => episode.publicId === "EP12")).toBe(false);
  });

  it("returns a sparse selection in reading order, not in check order", () => {
    expect(
      episodesSelectedInReadingOrder(episodes, ["EP11", "EP01", "EP07"]).map(
        (episode) => episode.publicId
      )
    ).toEqual(["EP01", "EP07", "EP11"]);
  });

  it("drops ids that are not in the series", () => {
    expect(
      episodesSelectedInReadingOrder(episodes, ["MISSING", "EP07"])
    ).toEqual([{ publicId: "EP07", title: "Episode 7" }]);
  });

  it("is empty when nothing checked is on the series", () => {
    expect(episodesSelectedInReadingOrder(episodes, [])).toEqual([]);
    expect(episodesSelectedInReadingOrder(episodes, ["MISSING"])).toEqual([]);
  });
});

describe("MAX_BULK_EPISODE_CREDIT_EPISODES", () => {
  it("matches the RPC bound so the console refuses a selection the server would", () => {
    expect(MAX_BULK_EPISODE_CREDIT_EPISODES).toBe(1000);
  });
});
