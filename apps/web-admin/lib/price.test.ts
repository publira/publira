import { describe, expect, it } from "vitest";

import {
  maxPriceInputValue,
  priceFormSchema,
  priceInputStep,
  toPriceInputValue,
} from "./price";

describe("toPriceInputValue", () => {
  it("writes a JPY amount as whole yen", () => {
    expect(toPriceInputValue(500, "JPY")).toBe("500");
  });

  it("writes a USD amount from its cents", () => {
    expect(toPriceInputValue(499, "USD")).toBe("4.99");
    expect(toPriceInputValue(500, "USD")).toBe("5.00");
  });
});

describe("priceInputStep", () => {
  it("steps by one minor unit of the currency", () => {
    expect(priceInputStep("JPY")).toBe("1");
    expect(priceInputStep("USD")).toBe("0.01");
  });
});

describe("maxPriceInputValue", () => {
  it("writes the largest int32 in the currency", () => {
    expect(maxPriceInputValue("JPY")).toBe("2147483647");
    expect(maxPriceInputValue("USD")).toBe("21474836.47");
  });
});

describe("priceFormSchema", () => {
  const message = "invalid";

  it("reads a JPY price as whole yen", () => {
    expect(priceFormSchema("JPY", message).parse("500")).toBe(500);
  });

  it("reads a USD price into cents", () => {
    const schema = priceFormSchema("USD", message);
    expect(schema.parse("4.99")).toBe(499);
    expect(schema.parse("4.9")).toBe(490);
    expect(schema.parse("5")).toBe(500);
  });

  it("reads a blank as the free price", () => {
    expect(priceFormSchema("USD", message).parse("  ")).toBe(0);
  });

  it("refuses more decimal places than the currency has", () => {
    expect(priceFormSchema("JPY", message).safeParse("500.5").success).toBe(
      false
    );
    expect(priceFormSchema("USD", message).safeParse("4.999").success).toBe(
      false
    );
  });

  it("refuses what is not a price", () => {
    const schema = priceFormSchema("USD", message);
    for (const value of ["-1", "1e3", "abc", "4,99"]) {
      expect(schema.safeParse(value).success).toBe(false);
    }
  });

  it("refuses a price past what the API holds", () => {
    expect(
      priceFormSchema("USD", message).safeParse("21474836.48").success
    ).toBe(false);
  });
});
