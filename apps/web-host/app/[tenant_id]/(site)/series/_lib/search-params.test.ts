import { describe, expect, it } from "vitest";

import { parseSeriesListSearchParams, seriesListHref } from "./search-params";

describe("parseSeriesListSearchParams", () => {
  it("base64url の token は前後の空白だけ落として通す", () => {
    expect(parseSeriesListSearchParams({ token: " djF8Zg-_ " })).toEqual({
      token: "djF8Zg-_",
    });
  });

  it("token が無ければ先頭ページ扱いにする", () => {
    expect(parseSeriesListSearchParams({})).toEqual({ token: "" });
    expect(parseSeriesListSearchParams({ token: "" })).toEqual({ token: "" });
  });

  it("base64url 以外・複数値・長すぎる token は捨てる", () => {
    expect(parseSeriesListSearchParams({ token: "djF8Zg==" })).toEqual({
      token: "",
    });
    expect(parseSeriesListSearchParams({ token: "v1|f|2026" })).toEqual({
      token: "",
    });
    expect(parseSeriesListSearchParams({ token: "dj F8Zg" })).toEqual({
      token: "",
    });
    expect(parseSeriesListSearchParams({ token: ["a", "b"] })).toEqual({
      token: "",
    });
    expect(parseSeriesListSearchParams({ token: "a".repeat(513) })).toEqual({
      token: "",
    });
  });
});

describe("seriesListHref", () => {
  it("token 付きのクエリを組み立てる", () => {
    expect(seriesListHref("djF8Zg")).toBe("/series?token=djF8Zg");
  });

  it("token が空なら先頭ページへ戻す", () => {
    expect(seriesListHref("")).toBe("/series");
  });
});
