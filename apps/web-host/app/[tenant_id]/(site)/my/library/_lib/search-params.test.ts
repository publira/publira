import { describe, expect, it } from "vitest";

import { parsePurchasesSearchParams, purchasesListHref } from "./search-params";

describe("parsePurchasesSearchParams", () => {
  it("有効な token を正規化する", () => {
    expect(parsePurchasesSearchParams({ token: " djF8Zg-_ " })).toEqual({
      token: "djF8Zg-_",
    });
  });

  it("不正な token は先頭ページに戻す", () => {
    expect(parsePurchasesSearchParams({ token: "not/a/token" })).toEqual({
      token: "",
    });
  });
});

describe("purchasesListHref", () => {
  it("token 付きの購入一覧 URL を組み立てる", () => {
    expect(purchasesListHref("next/page")).toBe(
      "/my/library?token=next%2Fpage"
    );
  });
});
