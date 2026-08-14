import { describe, expect, it } from "vitest";

import { parseResetPasswordRequestedSearchParams } from "./search-params";

describe("parseResetPasswordRequestedSearchParams", () => {
  it("keeps a well-formed email", () => {
    expect(
      parseResetPasswordRequestedSearchParams({
        email: "  operator@example.com  ",
      })
    ).toEqual({ email: "operator@example.com" });
  });

  it("drops a missing or malformed email", () => {
    expect(parseResetPasswordRequestedSearchParams({})).toEqual({ email: "" });
    expect(
      parseResetPasswordRequestedSearchParams({ email: "not-an-email" })
    ).toEqual({ email: "" });
  });
});
