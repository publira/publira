import { describe, expect, it } from "vitest";

import { parseConfirmEmailSearchParams } from "./search-params";

const VALID_TOKEN = "c".repeat(64);

describe("parseConfirmEmailSearchParams", () => {
  it("reads a valid token and drops a malformed one", () => {
    expect(parseConfirmEmailSearchParams({ token: VALID_TOKEN })).toEqual({
      token: VALID_TOKEN,
    });
    expect(parseConfirmEmailSearchParams({ token: "nope" })).toEqual({
      token: "",
    });
    expect(parseConfirmEmailSearchParams({})).toEqual({ token: "" });
  });
});
