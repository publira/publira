import { describe, expect, it } from "vitest";

import { buildSeriesPageHref, parseSeriesSearchParams } from "./search-params";

describe("parseSeriesSearchParams", () => {
  it("文字列の token をそのまま通す", () => {
    expect(parseSeriesSearchParams({ token: " cursor-token " })).toEqual({
      token: "cursor-token",
    });
  });

  it("token が無い場合は最初のページとして扱う", () => {
    expect(parseSeriesSearchParams({})).toEqual({ token: "" });
  });

  it("配列で渡された token は最初のページへ落とす", () => {
    expect(
      parseSeriesSearchParams({ token: ["cursor-a", "cursor-b"] })
    ).toEqual({ token: "" });
  });
});

describe("buildSeriesPageHref", () => {
  it("token をクエリだけの href にする", () => {
    expect(buildSeriesPageHref({ token: "cursor-token" })).toBe(
      "?token=cursor-token"
    );
  });

  it("token が空なら最初のページへ戻す", () => {
    expect(buildSeriesPageHref({ token: "" })).toBe("?");
  });
});
