import { describe, expect, it } from "vitest";

import { buildQueryString } from "./query-string";

describe("buildQueryString", () => {
  it("returns an empty string when every value is empty", () => {
    expect(
      buildQueryString({
        action: "",
        actor: "   ",
        cursor: undefined,
      })
    ).toBe("");
  });

  it("puts only the trimmed values into the query", () => {
    expect(
      buildQueryString({
        action: " series_created ",
        actor: " user_001 ",
      })
    ).toBe("?action=series_created&actor=user_001");
  });

  it("encodes a value that holds special characters", () => {
    expect(
      buildQueryString({
        actor: "Taro & Hanako",
      })
    ).toBe("?actor=Taro+%26+Hanako");
  });
});
