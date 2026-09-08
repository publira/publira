import { describe, expect, it } from "vitest";

import type { EpisodeItem } from "#lib/catalog";

import { resolveContinueOffer } from "./continue-offer";

const episode = (orderIndex: number): EpisodeItem => ({
  orderIndex,
  price: 0,
  publicId: `EPISODE_00${orderIndex}`,
  publishedAt: "2026-09-01T00:00:00Z",
  status: "published",
  title: `Episode ${orderIndex}`,
});

const episodes = [episode(1), episode(2), episode(3)];

describe("resolveContinueOffer", () => {
  it("invites a reader with no progress into the first episode", () => {
    expect(resolveContinueOffer(episodes, null)).toEqual({
      episodePublicId: "EPISODE_001",
      label: "host.series.progress_start",
      orderIndex: 1,
    });
  });

  it("sends a reader back into the episode they stopped in", () => {
    expect(
      resolveContinueOffer(episodes, {
        episode: { orderIndex: 2, publicId: "EPISODE_002", title: "Episode 2" },
        isFinished: false,
      })
    ).toEqual({
      episodePublicId: "EPISODE_002",
      label: "host.series.progress_continue",
      orderIndex: 2,
    });
  });

  it("moves on to the next episode once the reader finished one", () => {
    expect(
      resolveContinueOffer(episodes, {
        episode: { orderIndex: 2, publicId: "EPISODE_002", title: "Episode 2" },
        isFinished: true,
      })
    ).toEqual({
      episodePublicId: "EPISODE_003",
      label: "host.series.progress_start",
      orderIndex: 3,
    });
  });

  it("offers nothing to a reader who finished the last published episode", () => {
    expect(
      resolveContinueOffer(episodes, {
        episode: { orderIndex: 3, publicId: "EPISODE_003", title: "Episode 3" },
        isFinished: true,
      })
    ).toBeNull();
  });

  it("offers nothing for a series with no published episodes", () => {
    expect(resolveContinueOffer([], null)).toBeNull();
  });
});
