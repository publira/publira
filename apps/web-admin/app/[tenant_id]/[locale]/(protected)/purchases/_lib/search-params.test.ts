import { describe, expect, it } from "vitest";

import {
  parsePurchaseFilters,
  purchaseListQuery,
  purchasePeriod,
} from "./search-params";

const PURCHASE_ID = "018f0e6a-5000-7000-8000-000000000001";

describe("parsePurchaseFilters", () => {
  it("keeps every filter, the page, and the purchase the drawer shows", () => {
    expect(
      parsePurchaseFilters({
        email: " reader@example.com ",
        episode: "EPISODE001",
        from: "2026-03-01",
        purchase: PURCHASE_ID,
        series: "SERIES001",
        to: "2026-03-31",
        token: "page-2",
      })
    ).toEqual({
      email: "reader@example.com",
      episode: "EPISODE001",
      from: "2026-03-01",
      purchase: PURCHASE_ID,
      series: "SERIES001",
      to: "2026-03-31",
      token: "page-2",
    });
  });

  it("falls back to no filter for values it cannot use, and leaves the drawer closed for an id that is not a UUID", () => {
    expect(
      parsePurchaseFilters({
        email: ["a@example.com", "b@example.com"],
        from: "2026-02-30",
        purchase: "not-a-purchase",
        to: "yesterday",
      })
    ).toEqual({
      email: "",
      episode: "",
      from: "",
      purchase: "",
      series: "",
      to: "",
      token: "",
    });
  });
});

describe("purchaseListQuery", () => {
  const filters = parsePurchaseFilters({
    email: "reader@example.com",
    token: "page-2",
  });

  it("opens the drawer on a purchase while keeping the filters and the page", () => {
    expect(
      purchaseListQuery(filters, { purchase: PURCHASE_ID, token: "page-2" })
    ).toBe(`?email=reader%40example.com&purchase=${PURCHASE_ID}&token=page-2`);
  });

  it("stays on the route with an empty query when there is nothing to keep", () => {
    expect(purchaseListQuery(parsePurchaseFilters({}), {})).toBe("?");
  });
});

describe("purchasePeriod", () => {
  it("reads the days in the tenant's time zone and ends at the start of the day after the last", () => {
    expect(
      purchasePeriod({ from: "2026-03-01", to: "2026-03-31" }, "Asia/Tokyo")
    ).toEqual({
      purchasedFrom: "2026-02-28T15:00:00Z",
      purchasedTo: "2026-03-31T15:00:00Z",
    });
  });

  it("leaves an open end empty", () => {
    expect(purchasePeriod({ from: "", to: "2026-03-31" }, "UTC")).toEqual({
      purchasedFrom: "",
      purchasedTo: "2026-04-01T00:00:00Z",
    });
  });

  it("answers null for a period that ends before it starts", () => {
    expect(
      purchasePeriod({ from: "2026-03-02", to: "2026-03-01" }, "UTC")
    ).toBeNull();
  });
});
