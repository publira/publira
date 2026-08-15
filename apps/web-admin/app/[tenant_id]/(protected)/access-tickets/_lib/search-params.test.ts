import { describe, expect, it } from "vitest";

import { parseAccessTicketFilters } from "./search-params";

describe("parseAccessTicketFilters", () => {
  it("ページ token とフィルタを正規化する", () => {
    expect(
      parseAccessTicketFilters({
        active: "1",
        episode: " EPISODE001 ",
        token: " page-token ",
        user: " USER001 ",
      })
    ).toEqual({
      active: true,
      episode: "EPISODE001",
      token: "page-token",
      user: "USER001",
    });
  });

  it("複数値や不正なフィルタを空値にする", () => {
    expect(
      parseAccessTicketFilters({
        active: "maybe",
        episode: ["EPISODE001", "EPISODE002"],
        token: ["first", "second"],
        user: ["USER001", "USER002"],
      })
    ).toEqual({
      active: false,
      episode: "",
      token: "",
      user: "",
    });
  });

  it("未指定はフィルタなしの最初のページとして扱う", () => {
    expect(parseAccessTicketFilters({})).toEqual({
      active: false,
      episode: "",
      token: "",
      user: "",
    });
  });
});
