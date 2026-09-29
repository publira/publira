import { describe, expect, it } from "vitest";

import { parseConfirmEmailSearchParams } from "./search-params";

const VALID_TOKEN = "b".repeat(64);

describe("parseConfirmEmailSearchParams", () => {
  it("keeps a 64-char hex token", () => {
    expect(parseConfirmEmailSearchParams({ token: VALID_TOKEN })).toEqual({
      token: VALID_TOKEN,
    });
  });

  it("drops a missing or malformed token", () => {
    expect(parseConfirmEmailSearchParams({})).toEqual({ token: "" });
    expect(parseConfirmEmailSearchParams({ token: "short" })).toEqual({
      token: "",
    });
  });
});
