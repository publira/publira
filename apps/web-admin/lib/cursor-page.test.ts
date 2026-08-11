import { describe, expect, it } from "vitest";

import {
  cursorPageHref,
  cursorPageHrefs,
  cursorPageRequest,
  cursorPageTokens,
  DEFAULT_PAGE_SIZE,
  hasCursorPageLinks,
  parseCursorSearchParams,
} from "./cursor-page";

describe("parseCursorSearchParams", () => {
  it("文字列の token をそのまま通す", () => {
    expect(parseCursorSearchParams({ token: " cursor-token " })).toEqual({
      token: "cursor-token",
    });
  });

  it("token が無い場合は最初のページとして扱う", () => {
    expect(parseCursorSearchParams({})).toEqual({ token: "" });
  });

  it("配列で渡された token は最初のページへ落とす", () => {
    expect(
      parseCursorSearchParams({ token: ["cursor-a", "cursor-b"] })
    ).toEqual({ token: "" });
  });
});

describe("cursorPageRequest", () => {
  it("既定のページサイズと空トークンを補う", () => {
    expect(cursorPageRequest()).toEqual({
      limit: DEFAULT_PAGE_SIZE,
      token: "",
    });
  });

  it("指定された limit と token を優先する", () => {
    expect(cursorPageRequest({ limit: 1, token: "cursor-token" })).toEqual({
      limit: 1,
      token: "cursor-token",
    });
  });
});

describe("cursorPageTokens", () => {
  it("未設定のトークンを空文字へそろえる", () => {
    expect(cursorPageTokens({})).toEqual({ nextToken: "", previousToken: "" });
  });

  it("応答のトークンをそのまま返す", () => {
    expect(
      cursorPageTokens({ nextToken: "next", previousToken: "previous" })
    ).toEqual({ nextToken: "next", previousToken: "previous" });
  });
});

describe("cursorPageHref", () => {
  it("token をクエリだけの href にする", () => {
    expect(cursorPageHref("cursor-token")).toBe("?token=cursor-token");
  });

  it("token が空なら最初のページへ戻す", () => {
    expect(cursorPageHref("")).toBe("?");
  });
});

describe("cursorPageHrefs", () => {
  it("トークンのある向きだけリンクにする", () => {
    expect(cursorPageHrefs({ nextToken: "next", previousToken: "" })).toEqual({
      nextHref: "?token=next",
      previousHref: undefined,
    });
  });
});

describe("hasCursorPageLinks", () => {
  it("前後どちらかのリンクがあれば true", () => {
    expect(hasCursorPageLinks({ previousHref: "?token=previous" })).toBe(true);
    expect(hasCursorPageLinks({ nextHref: "?token=next" })).toBe(true);
  });

  it("リンクが無ければ false", () => {
    expect(hasCursorPageLinks({})).toBe(false);
  });
});
