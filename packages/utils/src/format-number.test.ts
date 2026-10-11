import { describe, expect, it } from "vitest";

import {
  currencyFractionDigits,
  formatPercent,
  formatPrice,
  formatYen,
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

  it("follows the locale rather than the host environment", () => {
    expect(formatPercent(0.625, { locale: "ja" })).toBe("62.5%");
  });
});

describe("formatYen", () => {
  it("renders a whole-yen amount with the currency sign and grouping", () => {
    expect(formatYen(1500, { locale: "en" })).toBe("¥1,500");
  });

  it("renders zero as an amount", () => {
    expect(formatYen(0, { locale: "en" })).toBe("¥0");
  });

  it("follows the locale rather than the host environment", () => {
    expect(formatYen(1_234_567, { locale: "ja" })).toBe("￥1,234,567");
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

  it("follows the locale rather than the host environment", () => {
    expect(formatPrice(1_234_567, { currency: "JPY", locale: "ja" })).toBe(
      "￥1,234,567"
    );
    expect(formatPrice(123_456, { currency: "USD", locale: "ja" })).toBe(
      "$1,234.56"
    );
  });
});

describe("currencyFractionDigits", () => {
  it("answers how far below the currency its minor unit sits", () => {
    expect(currencyFractionDigits("JPY")).toBe(0);
    expect(currencyFractionDigits("KRW")).toBe(0);
    expect(currencyFractionDigits("USD")).toBe(2);
  });
});
