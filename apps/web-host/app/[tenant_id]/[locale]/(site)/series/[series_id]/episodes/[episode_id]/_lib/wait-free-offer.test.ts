import { describe, expect, it } from "vitest";

import { toWaitFreeOffer, waitFreeEpisodeEligible } from "./wait-free-offer";

const rule = {
  accessHours: 72,
  excludedEpisodeIds: ["EPISODE_LATEST"],
  excludedLatestCount: 1,
  rechargeHours: 23,
};

describe("waitFreeEpisodeEligible", () => {
  it("admits an episode the rule does not keep a ticket off", () => {
    expect(waitFreeEpisodeEligible(rule, "EPISODE_OLDER")).toBe(true);
  });

  it("refuses one of the latest episodes, and every episode without a rule", () => {
    expect(waitFreeEpisodeEligible(rule, "EPISODE_LATEST")).toBe(false);
    expect(waitFreeEpisodeEligible(undefined, "EPISODE_OLDER")).toBe(false);
  });
});

describe("toWaitFreeOffer", () => {
  it("offers nothing on a series without the rule", () => {
    expect(
      toWaitFreeOffer({
        episodeId: "EPISODE_OLDER",
        rule: undefined,
        ticketState: undefined,
      })
    ).toBeUndefined();
  });

  it("names an excluded episode whoever the reader is", () => {
    expect(
      toWaitFreeOffer({
        episodeId: "EPISODE_LATEST",
        rule,
        ticketState: undefined,
      })
    ).toEqual({ kind: "excluded" });
  });

  it("asks a guest to sign in", () => {
    expect(
      toWaitFreeOffer({
        episodeId: "EPISODE_OLDER",
        rule,
        ticketState: undefined,
      })
    ).toEqual({ kind: "guest" });
  });

  it("offers a ready ticket with the period it opens the episode for", () => {
    expect(
      toWaitFreeOffer({
        episodeId: "EPISODE_OLDER",
        rule,
        ticketState: { ok: true, value: { ready: true } },
      })
    ).toEqual({ accessHours: 72, kind: "ready" });
  });

  it("counts down to a ticket that is still recharging", () => {
    expect(
      toWaitFreeOffer({
        episodeId: "EPISODE_OLDER",
        rule,
        ticketState: {
          ok: true,
          value: { nextAvailableAt: "2026-10-06T03:00:00Z", ready: false },
        },
      })
    ).toEqual({
      accessHours: 72,
      kind: "recharging",
      nextAvailableAt: "2026-10-06T03:00:00Z",
    });
  });

  it("says nothing when the API has nothing to offer the reader", () => {
    expect(
      toWaitFreeOffer({
        episodeId: "EPISODE_OLDER",
        rule,
        ticketState: { ok: true, value: null },
      })
    ).toBeUndefined();
  });

  it("carries the message of a state that could not be read", () => {
    expect(
      toWaitFreeOffer({
        episodeId: "EPISODE_OLDER",
        rule,
        ticketState: { message: "Could not connect.", ok: false },
      })
    ).toEqual({ kind: "unavailable", message: "Could not connect." });
  });
});
