import { describe, expect, it } from "vitest";

import { currencyItems } from "./currency-items";

describe("currencyItems", () => {
  it("names each currency in the locale with its code", () => {
    const items = currencyItems("en");

    expect(items).toContainEqual({ label: "US Dollar (USD)", value: "USD" });
    expect(items).toContainEqual({
      label: "Japanese Yen (JPY)",
      value: "JPY",
    });
    expect(currencyItems("ja")).toContainEqual({
      label: "日本円 (JPY)",
      value: "JPY",
    });
  });

  it("orders the currencies by the name the operator reads", () => {
    const labels = currencyItems("en").map((item) => item.label);

    expect(labels).toEqual(
      labels.toSorted((left, right) => left.localeCompare(right, "en"))
    );
  });

  it("keeps a stored code the runtime does not list", () => {
    const items = currencyItems("en", "ZWL");

    expect(items.filter((item) => item.value === "ZWL")).toHaveLength(1);
    expect(items.filter((item) => item.value === "USD")).toHaveLength(1);
  });
});
