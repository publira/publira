import { EpisodeReviewState } from "@publira/api-client/admin/types";
import { describe, expect, it } from "vitest";

import { pendingEpisodeReviewState } from "./episode-review-state";
import { toEpisodeReviewStateValue } from "./episode-review-state-enum";

describe("toEpisodeReviewStateValue", () => {
  it.each([
    [EpisodeReviewState.IN_REVIEW, "in_review"],
    [EpisodeReviewState.APPROVED, "approved"],
    [EpisodeReviewState.RETURNED, "returned"],
  ] as const)("names %s as %s", (state, value) => {
    expect(toEpisodeReviewStateValue(state)).toBe(value);
  });

  it.each([
    ["an episode never submitted", EpisodeReviewState.UNSPECIFIED],
    ["a response that carried no review", undefined],
    // SAFETY: a value no member of the enum holds, which is what a newer
    // server's state reads as on this build.
    ["a state this build does not know", 99 as EpisodeReviewState],
  ])("names nothing for %s", (_, state) => {
    expect(toEpisodeReviewStateValue(state)).toBe("");
  });
});

describe("pendingEpisodeReviewState", () => {
  it.each(["in_review", "returned"] as const)(
    "marks a scheduled episode %s while the tenant requires review",
    (reviewState) => {
      expect(
        pendingEpisodeReviewState({ reviewState, status: "scheduled" }, true)
      ).toBe(reviewState);
    }
  );

  it("does not mark an approved episode, which goes out at its time", () => {
    expect(
      pendingEpisodeReviewState(
        { reviewState: "approved", status: "scheduled" },
        true
      )
    ).toBeUndefined();
  });

  it("does not mark a published episode with the state its last round left", () => {
    expect(
      pendingEpisodeReviewState(
        { reviewState: "in_review", status: "published" },
        true
      )
    ).toBeUndefined();
  });

  it("does not mark anything while the tenant does not require review", () => {
    expect(
      pendingEpisodeReviewState(
        { reviewState: "returned", status: "scheduled" },
        false
      )
    ).toBeUndefined();
  });
});
