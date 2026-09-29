import { describe, expect, it } from "vitest";

import { parsePurchasesSearchParams, purchasesListHref } from "./search-params";

describe("parsePurchasesSearchParams", () => {
  it("Normalize valid tokens", () => {
    expect(parsePurchasesSearchParams({ token: " djF8Zg-_ " })).toEqual({
      token: "djF8Zg-_",
    });
  });

  it("Invalid tokens are returned to the first page", () => {
    expect(parsePurchasesSearchParams({ token: "not/a/token" })).toEqual({
      token: "",
    });
  });
});

describe("purchasesListHref", () => {
  it("Assemble purchase list URL with token", () => {
    expect(purchasesListHref("next/page")).toBe(
      "/my/library?token=next%2Fpage"
    );
  });
});
