import { describe, expect, it } from "vitest";

import { followsListHref, parseFollowsSearchParams } from "./search-params";

describe("parseFollowsSearchParams", () => {
  it("base64url の token は前後の空白だけ落として通す", () => {
    expect(parseFollowsSearchParams({ token: " djF8Zg-_ " })).toEqual({
      token: "djF8Zg-_",
    });
  });

  it("token が無ければ先頭ページ扱いにする", () => {
    expect(parseFollowsSearchParams({})).toEqual({ token: "" });
  });

  it("base64url 以外の token は捨てる", () => {
    expect(parseFollowsSearchParams({ token: "djF8Zg==" })).toEqual({
      token: "",
    });
    expect(parseFollowsSearchParams({ token: ["a", "b"] })).toEqual({
      token: "",
    });
  });
});

describe("followsListHref", () => {
  it("token 付きのクエリを組み立てる", () => {
    expect(followsListHref("next/page")).toBe(
      "/settings/follows?token=next%2Fpage"
    );
  });

  it("token が空なら先頭ページへ戻す", () => {
    expect(followsListHref("")).toBe("/settings/follows");
  });
});
