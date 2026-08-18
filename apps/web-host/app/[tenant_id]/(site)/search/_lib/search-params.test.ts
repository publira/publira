import { describe, expect, it } from "vitest";

import { parseSearchPageSearchParams, searchPageHref } from "./search-params";

describe("parseSearchPageSearchParams", () => {
  it("q と token を正規化する", () => {
    expect(
      parseSearchPageSearchParams({ q: "  Seed  ", token: " djF8Zg-_ " })
    ).toEqual({
      query: "Seed",
      token: "djF8Zg-_",
    });
  });

  it("q が無ければ空の検索画面にする", () => {
    expect(parseSearchPageSearchParams({})).toEqual({
      query: "",
      token: "",
    });
  });

  it("長すぎる q は上限で切る", () => {
    const longQuery = "あ".repeat(120);
    expect(parseSearchPageSearchParams({ q: longQuery })).toEqual({
      query: "あ".repeat(100),
      token: "",
    });
  });

  it("base64url 以外の token は捨てる", () => {
    expect(
      parseSearchPageSearchParams({ q: "Seed", token: "djF8Zg==" })
    ).toEqual({
      query: "Seed",
      token: "",
    });
  });
});

describe("searchPageHref", () => {
  it("q と token をクエリに載せる", () => {
    expect(searchPageHref("Seed Series", "djF8Zg")).toBe(
      "/search?q=Seed+Series&token=djF8Zg"
    );
  });

  it("token が空なら q だけ残す", () => {
    expect(searchPageHref("Seed", "")).toBe("/search?q=Seed");
  });

  it("両方空なら先頭の検索画面へ戻す", () => {
    expect(searchPageHref("", "")).toBe("/search");
  });
});
