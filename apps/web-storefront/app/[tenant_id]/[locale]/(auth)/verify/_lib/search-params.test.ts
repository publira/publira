import { describe, expect, it } from "vitest";

import { parseVerifySearchParams } from "./search-params";

const VALID_TOKEN = "d".repeat(64);

describe("parseVerifySearchParams", () => {
  it("reads a valid token and drops a malformed one", () => {
    expect(parseVerifySearchParams({ token: VALID_TOKEN })).toEqual({
      token: VALID_TOKEN,
    });
    expect(parseVerifySearchParams({ token: ["a", "b"] })).toEqual({
      token: "",
    });
  });
});
