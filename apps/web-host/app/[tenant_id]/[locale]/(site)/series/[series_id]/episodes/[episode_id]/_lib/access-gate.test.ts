import { describe, expect, it } from "vitest";

import { episodeAccessGateCopy, episodeLoginHref } from "./access-gate";

describe("episodeAccessGateCopy", () => {
  it("If you are not logged in, select the key that will guide you to purchase and receive tickets.", () => {
    expect(episodeAccessGateCopy(false, true)).toEqual({
      description: "host.episode.gate.guest_payable_description",
      title: "host.episode.gate.guest_title",
    });
  });

  it("If you are already logged in, select the key that indicates whether it is expired or not granted.", () => {
    expect(episodeAccessGateCopy(true, true)).toEqual({
      description: "host.episode.gate.signed_in_payable_description",
      title: "host.episode.gate.signed_in_title",
    });
  });

  it("Choose a key that does not prompt you for purchase when payment is not possible", () => {
    expect(episodeAccessGateCopy(false, false)).toEqual({
      description: "host.episode.gate.guest_unpayable_description",
      title: "host.episode.gate.guest_title",
    });
    expect(episodeAccessGateCopy(true, false)).toEqual({
      description: "host.episode.gate.signed_in_unpayable_description",
      title: "host.episode.gate.signed_in_title",
    });
  });
});

describe("episodeLoginHref", () => {
  it("Add returnTo to return to the episode you are viewing", () => {
    expect(episodeLoginHref("SERIES_001", "EP_010")).toBe(
      "/login?returnTo=%2Fseries%2FSERIES_001%2Fepisodes%2FEP_010"
    );
  });
});
