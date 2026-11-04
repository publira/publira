import { describe, expect, it } from "vitest";

import { parseTipAmount, parseTipAmounts } from "./tenant-tip-settings-shared";

describe("parseTipAmount", () => {
  it("reads an amount in the minor unit of the currency", () => {
    expect(parseTipAmount("300", "JPY")).toBe(300);
    expect(parseTipAmount("4.99", "USD")).toBe(499);
  });

  it.each([
    ["0", "JPY"],
    ["0.00", "USD"],
    ["-100", "JPY"],
    ["1.5", "JPY"],
    ["abc", "JPY"],
    ["2147483648", "JPY"],
  ])("refuses %s in %s", (value, currency) => {
    expect(parseTipAmount(value, currency)).toBeNull();
  });
});

describe("parseTipAmounts", () => {
  it("drops blank fields and answers the amounts in ascending order", () => {
    expect(parseTipAmounts(["1000", "", " 100 ", "300"], "JPY", true)).toEqual({
      amounts: [100, 300, 1000],
      ok: true,
    });
  });

  it("names the first field that is no amount above 0", () => {
    expect(parseTipAmounts(["100", "0", "x"], "JPY", true)).toEqual({
      amount: "0",
      ok: false,
      reason: "amount_invalid",
    });
  });

  // 3 and 3.00 are one amount in USD, so the second repeats the first.
  it("names an amount entered twice, however it is written", () => {
    expect(parseTipAmounts(["3", "1", "3.00"], "USD", true)).toEqual({
      amount: "3.00",
      ok: false,
      reason: "duplicate",
    });
  });

  it("refuses a seventh amount", () => {
    expect(
      parseTipAmounts(["1", "2", "3", "4", "5", "6", "7"], "JPY", true)
    ).toEqual({ ok: false, reason: "too_many" });
    expect(
      parseTipAmounts(["1", "2", "3", "4", "5", "6"], "JPY", true)
    ).toMatchObject({ ok: true });
  });

  it("asks for an amount only while tips are on", () => {
    expect(parseTipAmounts([""], "JPY", true)).toEqual({
      ok: false,
      reason: "none_while_enabled",
    });
    expect(parseTipAmounts([""], "JPY", false)).toEqual({
      amounts: [],
      ok: true,
    });
  });
});
