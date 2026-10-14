import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderGoCurrencyFormats, writeAmount } from "./go-currency.ts";

const locales = [
  { code: "ja", intl: "ja-JP" },
  { code: "en", intl: "en-US" },
];

describe("writeAmount", () => {
  const symbols = { decimal: ".", group: "," };

  it("groups the integer part and pads the minor unit", () => {
    assert.equal(
      writeAmount(123_456_705, 2, symbols, { prefix: "$", suffix: "" }),
      "$1,234,567.05"
    );
  });

  it("writes no decimal separator for a currency without a minor unit", () => {
    assert.equal(
      writeAmount(1500, 0, symbols, { prefix: "¥", suffix: "" }),
      "¥1,500"
    );
  });

  it("writes the text after the number", () => {
    assert.equal(
      writeAmount(0, 3, symbols, { prefix: "", suffix: " BHD" }),
      "0.000 BHD"
    );
  });
});

describe("renderGoCurrencyFormats", () => {
  const output = renderGoCurrencyFormats(locales, ["JPY", "USD", "AED"]);

  it("compiles the symbol each locale writes for each currency", () => {
    assert.match(output, /"ja": \{\n\t\t"JPY": \{Prefix: "￥"\},/u);
    assert.match(output, /"en": \{\n\t\t"JPY": \{Prefix: "¥"\},/u);
    assert.match(output, /\t\t"USD": \{Prefix: "\$"\},/u);
  });

  it("escapes the no-break space Intl writes after a code", () => {
    assert.match(output, /"AED": \{Prefix: "AED\\u00a0"\},/u);
  });

  it("compiles the digits of each currency's minor unit once", () => {
    assert.match(output, /\t"JPY": 0,\n\t"USD": 2,\n\t"AED": 2,\n/u);
  });
});
