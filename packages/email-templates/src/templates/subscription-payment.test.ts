import { describe, expect, it } from "vitest";

import { subscriptionPaymentDataSchema } from "./subscription-payment";

// A ¥980 monthly plan whose first month runs from 2 March to 2 April.
const data = {
  amount: 980,
  currency: "JPY",
  is_test: false,
  my_page_url: "https://aoto.example.com/my",
  period_end: "2026-04-02T00:00:00Z",
  period_start: "2026-03-02T00:00:00Z",
  plan_name: "All you can read",
  tenant_name: "Aoto Press",
} as const;

describe("subscriptionPaymentDataSchema", () => {
  it("accepts the variables the sender fills in", () => {
    expect(subscriptionPaymentDataSchema.parse(data)).toEqual(data);
  });

  it("rejects a payment of nothing or of a fraction of the minor unit", () => {
    expect(
      subscriptionPaymentDataSchema.safeParse({ ...data, amount: 0 }).success
    ).toBe(false);
    expect(
      subscriptionPaymentDataSchema.safeParse({ ...data, amount: 9.8 }).success
    ).toBe(false);
  });

  it("rejects a currency that is not an ISO 4217 code", () => {
    expect(
      subscriptionPaymentDataSchema.safeParse({ ...data, currency: "yen" })
        .success
    ).toBe(false);
  });

  it("rejects a period that ends before it starts", () => {
    expect(
      subscriptionPaymentDataSchema.safeParse({
        ...data,
        period_end: data.period_start,
        period_start: data.period_end,
      }).success
    ).toBe(false);
  });

  it("rejects a plan with no name and a link that is not http(s)", () => {
    expect(
      subscriptionPaymentDataSchema.safeParse({ ...data, plan_name: " " })
        .success
    ).toBe(false);
    expect(
      subscriptionPaymentDataSchema.safeParse({
        ...data,
        my_page_url: "ftp://aoto.example.com/my",
      }).success
    ).toBe(false);
  });
});
