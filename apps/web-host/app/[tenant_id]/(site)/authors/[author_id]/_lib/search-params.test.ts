import { describe, expect, it } from "vitest";

import {
  authorDetailHref,
  parseAuthorDetailSearchParams,
} from "./search-params";

// Token normalization itself is covered in `lib/cursor-token.test.ts`; these
// only pin down that this detail route is wired to it and points at the
// author.
describe("parseAuthorDetailSearchParams", () => {
  it("base64url の token は前後の空白だけ落として通す", () => {
    expect(parseAuthorDetailSearchParams({ token: " djF8Zg-_ " })).toEqual({
      token: "djF8Zg-_",
    });
  });

  it("token が無ければ先頭ページ扱いにする", () => {
    expect(parseAuthorDetailSearchParams({})).toEqual({ token: "" });
  });

  it("base64url 以外の token は捨てる", () => {
    expect(parseAuthorDetailSearchParams({ token: "djF8Zg==" })).toEqual({
      token: "",
    });
    expect(parseAuthorDetailSearchParams({ token: ["a", "b"] })).toEqual({
      token: "",
    });
  });
});

describe("authorDetailHref", () => {
  it("token 付きのクエリを組み立てる", () => {
    expect(authorDetailHref("CREATOR_A", "djF8Zg")).toBe(
      "/authors/CREATOR_A?token=djF8Zg"
    );
  });

  it("token が空なら先頭ページへ戻す", () => {
    expect(authorDetailHref("CREATOR_A", "")).toBe("/authors/CREATOR_A");
  });
});
