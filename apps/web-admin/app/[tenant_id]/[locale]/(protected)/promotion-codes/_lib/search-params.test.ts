import { describe, expect, it } from "vitest";

import {
  parsePromotionCodeParams,
  promotionCodeListQuery,
} from "./search-params";

const CODE_ID = "018f0e6a-7000-7000-8000-000000000001";

describe("parsePromotionCodeParams", () => {
  it("reads the drawer's code, its edit flag, and both pages", () => {
    expect(
      parsePromotionCodeParams({
        code: CODE_ID,
        edit: "1",
        redemptions: " r-page ",
        token: "l-page",
      })
    ).toEqual({
      code: CODE_ID,
      edit: true,
      redemptions: "r-page",
      token: "l-page",
    });
  });

  it("falls back to the list with the drawer closed", () => {
    expect(
      parsePromotionCodeParams({
        code: "not-a-uuid",
        edit: "yes",
        redemptions: ["a", "b"],
      })
    ).toEqual({ code: "", edit: false, redemptions: "", token: "" });
  });
});

describe("promotionCodeListQuery", () => {
  it("keeps the list's page under the drawer and drops what is empty", () => {
    expect(
      promotionCodeListQuery({ code: CODE_ID, edit: true, token: "l-page" })
    ).toBe(`?code=${CODE_ID}&edit=1&token=l-page`);
    expect(promotionCodeListQuery({ code: CODE_ID, redemptions: "" })).toBe(
      `?code=${CODE_ID}`
    );
  });

  it("is `?` for the first page with the drawer closed", () => {
    expect(promotionCodeListQuery({})).toBe("?");
  });
});
