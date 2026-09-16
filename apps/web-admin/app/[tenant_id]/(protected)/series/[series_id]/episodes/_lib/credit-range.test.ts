import { describe, expect, it } from "vitest";

import {
  MAX_BULK_EPISODE_CREDIT_EPISODES,
  episodesInInclusiveRange,
} from "./credit-range";

const episodes = Array.from({ length: 40 }, (_, index) => ({
  publicId: `EP${String(index + 1).padStart(2, "0")}`,
  title: `Episode ${index + 1}`,
}));

describe("episodesInInclusiveRange", () => {
  it("takes episodes 1–11 of a 40-episode series and nothing after episode 11", () => {
    const range = episodesInInclusiveRange(episodes, "EP01", "EP11");

    expect(range).toHaveLength(11);
    expect(range.at(0)?.publicId).toBe("EP01");
    expect(range.at(-1)?.publicId).toBe("EP11");
    expect(range.some((episode) => episode.publicId === "EP12")).toBe(false);
    expect(range.at(-1)?.publicId === episodes.at(-1)?.publicId).toBe(false);
  });

  it("uses reading order when the ends are picked the other way around", () => {
    expect(episodesInInclusiveRange(episodes, "EP11", "EP01")).toEqual(
      episodesInInclusiveRange(episodes, "EP01", "EP11")
    );
  });

  it("is a single episode when both ends name the same one", () => {
    expect(episodesInInclusiveRange(episodes, "EP07", "EP07")).toEqual([
      { publicId: "EP07", title: "Episode 7" },
    ]);
  });

  it("is empty until both ends are chosen from the list", () => {
    expect(episodesInInclusiveRange(episodes, "", "EP11")).toEqual([]);
    expect(episodesInInclusiveRange(episodes, "EP01", "")).toEqual([]);
    expect(episodesInInclusiveRange(episodes, "MISSING", "EP11")).toEqual([]);
    expect(episodesInInclusiveRange(episodes, "EP01", "MISSING")).toEqual([]);
  });
});

describe("MAX_BULK_EPISODE_CREDIT_EPISODES", () => {
  it("matches the RPC bound so the console refuses a range the server would", () => {
    expect(MAX_BULK_EPISODE_CREDIT_EPISODES).toBe(1000);
  });
});
