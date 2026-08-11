import { describe, expect, it } from "vitest";

import { parseSeriesListSearchParams, seriesListHref } from "./search-params";

// Token normalization itself is covered in `lib/cursor-token.test.ts`; these
// only pin down that this list is wired to it and points at `/series`.
describe("parseSeriesListSearchParams", () => {
  it("base64url の token は前後の空白だけ落として通す", () => {
    expect(parseSeriesListSearchParams({ token: " djF8Zg-_ " })).toEqual({
      token: "djF8Zg-_",
    });
  });

  it("token が無ければ先頭ページ扱いにする", () => {
    expect(parseSeriesListSearchParams({})).toEqual({ token: "" });
  });

  it("base64url 以外の token は捨てる", () => {
    expect(parseSeriesListSearchParams({ token: "djF8Zg==" })).toEqual({
      token: "",
    });
    expect(parseSeriesListSearchParams({ token: ["a", "b"] })).toEqual({
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
