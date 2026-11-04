import { describe, expect, it } from "vitest";

import {
  invoiceLegalNameProblem,
  invoiceRegistrationNumberProblem,
  ratePercentToBps,
} from "./tenant-tax-settings-shared";

describe("ratePercentToBps", () => {
  it.each([
    ["10", 1000],
    [" 8 ", 800],
    ["10.21", 1021],
    ["0.01", 1],
    ["100", 10_000],
  ])("reads %j as %i basis points", (text, bps) => {
    expect(ratePercentToBps(text)).toBe(bps);
  });

  it("reads an empty field as no rate", () => {
    expect(ratePercentToBps("  ")).toBeNull();
  });

  it.each(["0", "0.00", "100.01", "10.215", "-5", "ten", "10%"])(
    "refuses %j",
    (text) => {
      expect(ratePercentToBps(text)).toBeUndefined();
    }
  );
});

describe("invoiceLegalNameProblem", () => {
  it("accepts a name of up to 200 characters, counted by code point", () => {
    expect(invoiceLegalNameProblem("出版社".repeat(66))).toBeUndefined();
    expect(invoiceLegalNameProblem("𠮷".repeat(200))).toBeUndefined();
  });

  it("refuses a longer name and one with a control character", () => {
    expect(invoiceLegalNameProblem("a".repeat(201))).toBe("too_long");
    expect(invoiceLegalNameProblem("Example\nPublishing")).toBe("control");
  });
});

describe("invoiceRegistrationNumberProblem", () => {
  it("accepts a number without whitespace of up to 32 characters", () => {
    expect(invoiceRegistrationNumberProblem("T1234567890123")).toBeUndefined();
  });

  it("refuses a longer number and one with whitespace", () => {
    expect(invoiceRegistrationNumberProblem("T".repeat(33))).toBe("too_long");
    expect(invoiceRegistrationNumberProblem("T123 4567")).toBe("whitespace");
    expect(invoiceRegistrationNumberProblem("T123　")).toBe("whitespace");
  });
});
