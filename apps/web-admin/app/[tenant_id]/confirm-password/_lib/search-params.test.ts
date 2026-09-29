import { describe, expect, it } from "vitest";

import { parseConfirmPasswordSearchParams } from "./search-params";

const VALID_TOKEN = "a".repeat(64);

describe("parseConfirmPasswordSearchParams", () => {
  it("reads a valid token and an error message", () => {
    expect(
      parseConfirmPasswordSearchParams({
        error: "  Something went wrong  ",
        token: VALID_TOKEN,
      })
    ).toEqual({
      errorMessage: "Something went wrong",
      status: "",
      token: VALID_TOKEN,
    });
  });

  it("keeps an explicit failure status and drops a malformed token", () => {
    expect(
      parseConfirmPasswordSearchParams({
        status: "expired",
        token: "not-a-token",
      })
    ).toEqual({
      errorMessage: undefined,
      status: "expired",
      token: "",
    });
  });

  it("ignores an unknown status", () => {
    expect(parseConfirmPasswordSearchParams({ status: "nope" })).toEqual({
      errorMessage: undefined,
      status: "",
      token: "",
    });
  });
});
