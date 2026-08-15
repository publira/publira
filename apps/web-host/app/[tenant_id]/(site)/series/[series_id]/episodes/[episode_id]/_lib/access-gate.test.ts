import { describe, expect, it } from "vitest";

import { episodeAccessGateCopy, episodeLoginHref } from "./access-gate";

describe("episodeAccessGateCopy", () => {
  it("未ログインは購入とチケット付与を案内する", () => {
    const copy = episodeAccessGateCopy(false);

    expect(copy.title).toBe("このエピソードは有料です");
    expect(copy.description).toContain("ログイン");
    expect(copy.description).toContain("購入");
    expect(copy.description).toContain("チケット");
  });

  it("ログイン済みは失効と未付与を案内する", () => {
    const copy = episodeAccessGateCopy(true);

    expect(copy.title).toBe("このエピソードは閲覧できません");
    expect(copy.description).toContain("有効期限");
    expect(copy.description).toContain("付与");
  });
});

describe("episodeLoginHref", () => {
  it("閲覧中のエピソードへ戻る returnTo を付ける", () => {
    expect(episodeLoginHref("SERIES_001", "EP_010")).toBe(
      "/login?returnTo=%2Fseries%2FSERIES_001%2Fepisodes%2FEP_010"
    );
  });
});
