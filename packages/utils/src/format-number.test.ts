import { describe, expect, it } from "vitest";

import {
  currencyDisplayName,
  currencyFractionDigits,
  formatPercent,
  formatPrice,
  listSupportedCurrencies,
  toMajorUnitDecimal,
} from "./format-number";

describe("formatPercent", () => {
  it("renders a ratio as a percentage with one fraction digit", () => {
    expect(formatPercent(0.625, { locale: "en" })).toBe("62.5%");
  });

  it("keeps the fraction digit on a whole percentage", () => {
    expect(formatPercent(0.5, { locale: "en" })).toBe("50.0%");
  });

  it("renders zero rather than treating it as absent", () => {
    expect(formatPercent(0, { locale: "en" })).toBe("0.0%");
  });

  it("honours the requested number of fraction digits", () => {
    expect(formatPercent(0.12345, { fractionDigits: 2, locale: "en" })).toBe(
      "12.35%"
    );
  });

  it("renders a bigint amount from its minor unit", () => {
    expect(formatPrice(1500n, { currency: "JPY", locale: "en" })).toBe(
      "¥1,500"
    );
    expect(formatPrice(499n, { currency: "USD", locale: "en" })).toBe("$4.99");
    expect(formatPrice(5n, { currency: "USD", locale: "en" })).toBe("$0.05");
    expect(formatPrice(-1250n, { currency: "USD", locale: "en" })).toBe(
      "-$12.50"
    );
  });

  it("keeps every digit of a bigint amount past what a float holds exactly", () => {
    expect(
      formatPrice(9_007_199_254_740_993n, { currency: "USD", locale: "en" })
    ).toBe("$90,071,992,547,409.93");
  });

  it("follows the locale rather than the host environment", () => {
    expect(formatPercent(0.625, { locale: "ja" })).toBe("62.5%");
  });
});

describe("formatPrice", () => {
  it("renders a JPY amount as whole yen", () => {
    expect(formatPrice(1500, { currency: "JPY", locale: "en" })).toBe("¥1,500");
  });

  it("renders a USD amount from its cents", () => {
    expect(formatPrice(499, { currency: "USD", locale: "en" })).toBe("$4.99");
  });

  it("keeps the fraction digits of a whole amount in a currency with decimals", () => {
    expect(formatPrice(500, { currency: "EUR", locale: "en" })).toBe("€5.00");
  });

  it("renders zero as an amount", () => {
    expect(formatPrice(0, { currency: "USD", locale: "en" })).toBe("$0.00");
  });

  it("renders a bigint amount from its minor unit", () => {
    expect(formatPrice(1500n, { currency: "JPY", locale: "en" })).toBe(
      "¥1,500"
    );
    expect(formatPrice(499n, { currency: "USD", locale: "en" })).toBe("$4.99");
    expect(formatPrice(5n, { currency: "USD", locale: "en" })).toBe("$0.05");
    expect(formatPrice(-1250n, { currency: "USD", locale: "en" })).toBe(
      "-$12.50"
    );
  });

  it("keeps every digit of a bigint amount past what a float holds exactly", () => {
    expect(
      formatPrice(9_007_199_254_740_993n, { currency: "USD", locale: "en" })
    ).toBe("$90,071,992,547,409.93");
  });

  it("follows the locale rather than the host environment", () => {
    expect(formatPrice(1_234_567, { currency: "JPY", locale: "ja" })).toBe(
      "￥1,234,567"
    );
    expect(formatPrice(123_456, { currency: "USD", locale: "ja" })).toBe(
      "$1,234.56"
    );
  });
});

describe("toMajorUnitDecimal", () => {
  it("writes an amount in the currency's own unit", () => {
    expect(toMajorUnitDecimal(499n, "USD")).toBe("4.99");
    expect(toMajorUnitDecimal(5n, "USD")).toBe("0.05");
    expect(toMajorUnitDecimal(-1250n, "USD")).toBe("-12.50");
    expect(toMajorUnitDecimal(1500n, "JPY")).toBe("1500");
  });
});

describe("currencyFractionDigits", () => {
  it("answers how far below the currency its minor unit sits", () => {
    expect(currencyFractionDigits("JPY")).toBe(0);
    expect(currencyFractionDigits("KRW")).toBe(0);
    expect(currencyFractionDigits("USD")).toBe(2);
  });
});

describe("currencyDisplayName", () => {
  it("names a currency in the UI locale", () => {
    expect(currencyDisplayName("USD", { locale: "en" })).toBe("US Dollar");
    expect(currencyDisplayName("JPY", { locale: "ja" })).toBe("日本円");
  });
});

describe("listSupportedCurrencies", () => {
  it("lists the runtime's ISO 4217 codes in order of code", () => {
    const currencies = listSupportedCurrencies();

    expect(currencies).toContain("JPY");
    expect(currencies).toContain("USD");
    expect(currencies).toEqual(currencies.toSorted());
  });
});
