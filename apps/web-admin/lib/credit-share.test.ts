import { describe, expect, it } from "vitest";

import {
  formatShareBps,
  isCreditShareTotalSavable,
  shareBpsToPercentText,
  sharePercentToBps,
  totalCreditShares,
} from "./credit-share";

describe("sharePercentToBps", () => {
  it.each([
    ["30", 3000],
    ["33.33", 3333],
    ["0.5", 50],
    ["0.05", 5],
    ["100", 10_000],
    [" 12.5 ", 1250],
    ["", 0],
  ])("reads %j as %d basis points", (text, bps) => {
    expect(sharePercentToBps(text)).toBe(bps);
  });

  it.each(["33.333", "100.01", "101", "-1", "abc", "1e2", "12,5", "."])(
    "refuses %j",
    (text) => {
      expect(sharePercentToBps(text)).toBeUndefined();
    }
  );
});

describe("shareBpsToPercentText", () => {
  it.each([
    [3000, "30"],
    [3333, "33.33"],
    [50, "0.5"],
    [5, "0.05"],
    [0, "0"],
    [10_000, "100"],
  ])("writes %d basis points as %j", (bps, text) => {
    expect(shareBpsToPercentText(bps)).toBe(text);
  });

  it("round-trips through the parser", () => {
    for (const bps of [0, 1, 99, 1234, 3333, 9999, 10_000]) {
      expect(sharePercentToBps(shareBpsToPercentText(bps))).toBe(bps);
    }
  });
});

describe("formatShareBps", () => {
  it("formats in the viewer's locale with up to two decimals", () => {
    expect(formatShareBps(3333, "en")).toBe("33.33%");
    expect(formatShareBps(5000, "en")).toBe("50%");
  });
});

describe("totalCreditShares", () => {
  it("sums the shares and allows up to 100%", () => {
    const total = totalCreditShares(["60", "40"]);
    expect(total).toEqual({ hasInvalid: false, totalBps: 10_000 });
    expect(isCreditShareTotalSavable(total)).toBe(true);
  });

  it("refuses a total over 100%", () => {
    const total = totalCreditShares(["60", "50"]);
    expect(total.totalBps).toBe(11_000);
    expect(isCreditShareTotalSavable(total)).toBe(false);
  });

  it("refuses a list with a box that holds no share", () => {
    const total = totalCreditShares(["10", "ten"]);
    expect(total.hasInvalid).toBe(true);
    expect(isCreditShareTotalSavable(total)).toBe(false);
  });
});
