import { describe, expect, it } from "vitest";

import { deliveryListQuery, parseDeliveryFilters } from "./search-params";

describe("parseDeliveryFilters", () => {
  it("reads the status and the page", () => {
    expect(parseDeliveryFilters({ status: "dead", token: " abc " })).toEqual({
      status: "dead",
      token: "abc",
    });
  });

  it.each([
    ["an unknown status", { status: "delivered" }],
    ["a repeated status", { status: ["failed", "dead"] }],
    ["no status", {}],
  ])("lists every delivery for %s", (_label, input) => {
    expect(parseDeliveryFilters(input).status).toBe("");
  });
});

describe("deliveryListQuery", () => {
  it("keeps the status beside the page", () => {
    expect(deliveryListQuery("failed", "next")).toBe(
      "?status=failed&token=next"
    );
  });

  it("drops the page when only the status is named", () => {
    expect(deliveryListQuery("dead")).toBe("?status=dead");
  });

  it("answers the bare query for every delivery on the first page", () => {
    expect(deliveryListQuery("")).toBe("?");
  });
});
