import { Code, ConnectError } from "@publira/api-client/errors";
import { EpisodeRatingMode } from "@publira/api-client/public/catalog";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyReactionPress,
  getMyEpisodeRating,
  rateEpisode,
  reactionFillRatio,
  toEpisodeReactionMode,
} from "./episode-rating";

const { mockGetMyEpisodeRating, mockRateEpisode, mockResolveAccessToken } =
  vi.hoisted(() => ({
    mockGetMyEpisodeRating: vi.fn(),
    mockRateEpisode: vi.fn(),
    mockResolveAccessToken: vi.fn(),
  }));

vi.mock("./api-client", () => ({
  apiClient: {
    rating: {
      getMyEpisodeRating: mockGetMyEpisodeRating,
      rateEpisode: mockRateEpisode,
    },
  },
  buildSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
  resolveAccessToken: mockResolveAccessToken,
}));

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("toEpisodeReactionMode", () => {
  it("maps the multiple enum onto the five-press control", () => {
    expect(toEpisodeReactionMode(EpisodeRatingMode.MULTIPLE)).toBe("multiple");
  });

  it("treats single and unspecified as one press", () => {
    expect(toEpisodeReactionMode(EpisodeRatingMode.SINGLE)).toBe("single");
    expect(toEpisodeReactionMode(EpisodeRatingMode.UNSPECIFIED)).toBe("single");
    expect(toEpisodeReactionMode()).toBe("single");
  });
});

describe("applyReactionPress", () => {
  it("fills the control and counts the reader once in single mode", () => {
    expect(applyReactionPress({ ratingCount: 3, score: 0 }, "single")).toEqual({
      ratingCount: 4,
      score: 5,
    });
  });

  it("leaves a second press in single mode unchanged", () => {
    expect(applyReactionPress({ ratingCount: 4, score: 5 }, "single")).toEqual({
      ratingCount: 4,
      score: 5,
    });
  });

  it("raises the score one step at a time in multiple mode", () => {
    expect(
      applyReactionPress({ ratingCount: 3, score: 0 }, "multiple")
    ).toEqual({ ratingCount: 4, score: 1 });
    expect(
      applyReactionPress({ ratingCount: 4, score: 1 }, "multiple")
    ).toEqual({ ratingCount: 4, score: 2 });
  });

  it("counts the reader once across five presses in multiple mode", () => {
    let state = { ratingCount: 10, score: 0 };
    for (let i = 0; i < 5; i += 1) {
      state = applyReactionPress(state, "multiple");
    }

    expect(state).toEqual({ ratingCount: 11, score: 5 });
    expect(applyReactionPress(state, "multiple")).toEqual(state);
  });
});

describe("reactionFillRatio", () => {
  it("fills the whole heart after one press in single mode", () => {
    expect(reactionFillRatio(0, "single")).toBe(0);
    expect(reactionFillRatio(5, "single")).toBe(1);
  });

  it("fills the heart by how far the reader has taken it in multiple mode", () => {
    expect(reactionFillRatio(0, "multiple")).toBe(0);
    expect(reactionFillRatio(2, "multiple")).toBe(0.4);
    expect(reactionFillRatio(5, "multiple")).toBe(1);
  });
});

describe("getMyEpisodeRating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccessToken.mockResolvedValue("session-token");
  });

  it("skips the RPC for a guest and reports them as signed out", async () => {
    mockResolveAccessToken.mockResolvedValueOnce("");

    const result = await getMyEpisodeRating(tenantId, "EPISODE01", "en");

    expect(result).toEqual({
      mode: "single",
      ok: true,
      ratingCount: 0,
      score: 0,
      signedIn: false,
    });
    expect(mockGetMyEpisodeRating).not.toHaveBeenCalled();
  });

  it("returns the member's score, the headcount, and the press mode", async () => {
    mockGetMyEpisodeRating.mockResolvedValueOnce({
      mode: EpisodeRatingMode.MULTIPLE,
      ratingCount: 12,
      score: 3,
    });

    const result = await getMyEpisodeRating(tenantId, "EPISODE01", "en");

    expect(mockGetMyEpisodeRating).toHaveBeenCalledWith(
      {
        episodePublicId: "EPISODE01",
        tenant: { tenantId },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({
      mode: "multiple",
      ok: true,
      ratingCount: 12,
      score: 3,
      signedIn: true,
    });
  });

  it("treats an expired session as signed out so the page stays public", async () => {
    mockGetMyEpisodeRating.mockRejectedValueOnce(
      new ConnectError("expired", Code.Unauthenticated)
    );

    const result = await getMyEpisodeRating(tenantId, "EPISODE01", "en");

    expect(result).toEqual({
      mode: "single",
      ok: true,
      ratingCount: 0,
      score: 0,
      signedIn: false,
    });
  });

  it("uses the shared not-found wording when the episode is missing", async () => {
    mockGetMyEpisodeRating.mockRejectedValueOnce(
      new ConnectError("missing", Code.NotFound)
    );

    const result = await getMyEpisodeRating(tenantId, "MISSING01", "en");

    expect(result).toEqual({
      message: "The requested item could not be found.",
      ok: false,
    });
  });
});

describe("rateEpisode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccessToken.mockResolvedValue("session-token");
  });

  it("returns the score and headcount after a press", async () => {
    mockRateEpisode.mockResolvedValueOnce({
      mode: EpisodeRatingMode.SINGLE,
      ratingCount: 4,
      score: 5,
    });

    await expect(
      rateEpisode({
        episodePublicId: "EPISODE01",
        locale: "en",
        presses: 1,
        tenantId,
      })
    ).resolves.toEqual({
      mode: "single",
      ok: true,
      ratingCount: 4,
      score: 5,
    });
    expect(mockRateEpisode).toHaveBeenCalledWith(
      {
        episodePublicId: "EPISODE01",
        presses: 1,
        tenant: { tenantId },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("rethrows unauthenticated so the Action can send the reader to login", async () => {
    mockRateEpisode.mockRejectedValueOnce(
      new ConnectError("expired", Code.Unauthenticated)
    );

    await expect(
      rateEpisode({
        episodePublicId: "EPISODE01",
        locale: "en",
        presses: 1,
        tenantId,
      })
    ).rejects.toBeInstanceOf(ConnectError);
  });
});
