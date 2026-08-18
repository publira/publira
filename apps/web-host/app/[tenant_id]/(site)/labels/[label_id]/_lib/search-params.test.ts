import { describe, expect, it } from "vitest";

import { labelDetailHref, parseLabelDetailSearchParams } from "./search-params";

// Token normalization itself is covered in `lib/cursor-token.test.ts`; these
// only pin down that this detail route is wired to it and points at the
// label.
describe("parseLabelDetailSearchParams", () => {
  it("base64url の token は前後の空白だけ落として通す", () => {
    expect(parseLabelDetailSearchParams({ token: " djF8Zg-_ " })).toEqual({
      token: "djF8Zg-_",
    });
  });

  it("token が無ければ先頭ページ扱いにする", () => {
    expect(parseLabelDetailSearchParams({})).toEqual({ token: "" });
  });

  it("base64url 以外の token は捨てる", () => {
    expect(parseLabelDetailSearchParams({ token: "djF8Zg==" })).toEqual({
      token: "",
    });
    expect(parseLabelDetailSearchParams({ token: ["a", "b"] })).toEqual({
      token: "",
    });
  });
});

describe("labelDetailHref", () => {
  it("token 付きのクエリを組み立てる", () => {
    expect(labelDetailHref("LABEL_A", "djF8Zg")).toBe(
      "/labels/LABEL_A?token=djF8Zg"
    );
  });

  it("token が空なら先頭ページへ戻す", () => {
    expect(labelDetailHref("LABEL_A", "")).toBe("/labels/LABEL_A");
  });
});
