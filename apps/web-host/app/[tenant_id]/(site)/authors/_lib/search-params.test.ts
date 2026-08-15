import { describe, expect, it } from "vitest";

import { authorsListHref, parseAuthorsListSearchParams } from "./search-params";

// Token normalization itself is covered in `lib/cursor-token.test.ts`; these
// only pin down that this list is wired to it and points at `/authors`.
describe("parseAuthorsListSearchParams", () => {
  it("base64url の token は前後の空白だけ落として通す", () => {
    expect(parseAuthorsListSearchParams({ token: " djF8Zg-_ " })).toEqual({
      token: "djF8Zg-_",
    });
  });

  it("token が無ければ先頭ページ扱いにする", () => {
    expect(parseAuthorsListSearchParams({})).toEqual({ token: "" });
  });

  it("base64url 以外の token は捨てる", () => {
    expect(parseAuthorsListSearchParams({ token: "djF8Zg==" })).toEqual({
      token: "",
    });
    expect(parseAuthorsListSearchParams({ token: ["a", "b"] })).toEqual({
      token: "",
    });
  });
});

describe("authorsListHref", () => {
  it("token 付きのクエリを組み立てる", () => {
    expect(authorsListHref("djF8Zg")).toBe("/authors?token=djF8Zg");
  });

  it("token が空なら先頭ページへ戻す", () => {
    expect(authorsListHref("")).toBe("/authors");
  });
});
