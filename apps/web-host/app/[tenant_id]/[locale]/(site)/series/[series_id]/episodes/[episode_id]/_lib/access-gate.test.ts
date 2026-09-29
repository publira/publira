import { describe, expect, it } from "vitest";

import { episodeLoginHref } from "./access-gate";

describe("episodeLoginHref", () => {
  it("Add returnTo to return to the episode you are viewing", () => {
    expect(episodeLoginHref("SERIES_001", "EP_010")).toBe(
      "/login?returnTo=%2Fseries%2FSERIES_001%2Fepisodes%2FEP_010"
    );
  });
});
