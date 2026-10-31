import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderGoDateTimeFormats } from "./go-datetime.ts";

describe("renderGoDateTimeFormats", () => {
  it("writes the space before an English day period as format() does", () => {
    const formatted = new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(0);

    assert.match(formatted, /00 AM$/u);

    const rendered = renderGoDateTimeFormats([{ code: "en", intl: "en-US" }]);
    assert.doesNotMatch(rendered, /\\u202f/u);
    assert.match(
      rendered,
      /\{Kind: FieldLiteral, Text: " "\},\n\t+\{Kind: FieldDayPeriod,/u
    );
  });
});
