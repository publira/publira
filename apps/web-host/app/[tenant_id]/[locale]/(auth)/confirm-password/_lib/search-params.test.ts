import { describe, expect, it } from "vitest";

import { parseConfirmPasswordSearchParams } from "./search-params";

const VALID_TOKEN = "b".repeat(64);

describe("parseConfirmPasswordSearchParams", () => {
  it("reads a valid token and error message", () => {
    expect(
      parseConfirmPasswordSearchParams({
        error: "  Could not reset your password  ",
        token: VALID_TOKEN,
      })
    ).toEqual({
      errorMessage: "Could not reset your password",
      token: VALID_TOKEN,
    });
  });

  it("treats a malformed token as missing", () => {
    expect(
      parseConfirmPasswordSearchParams({
        token: "not-a-token",
      })
    ).toEqual({
      errorMessage: undefined,
      token: "",
    });
  });
});
