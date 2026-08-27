import { describe, expect, it } from "vitest";

import { episodeAccessGateCopy, episodeLoginHref } from "./access-gate";

describe("episodeAccessGateCopy", () => {
  it("未ログインは購入とチケット付与を案内するキーを選ぶ", () => {
    expect(episodeAccessGateCopy(false, true)).toEqual({
      description: "host.episode.gate.guest_payable_description",
      title: "host.episode.gate.guest_title",
    });
  });

  it("ログイン済みは失効と未付与を案内するキーを選ぶ", () => {
    expect(episodeAccessGateCopy(true, true)).toEqual({
      description: "host.episode.gate.signed_in_payable_description",
      title: "host.episode.gate.signed_in_title",
    });
  });

  it("決済不可時は購入を案内しないキーを選ぶ", () => {
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
  it("閲覧中のエピソードへ戻る returnTo を付ける", () => {
    expect(episodeLoginHref("SERIES_001", "EP_010")).toBe(
      "/login?returnTo=%2Fseries%2FSERIES_001%2Fepisodes%2FEP_010"
    );
  });
});
