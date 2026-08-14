import { describe, expect, it } from "vitest";

import { parseResetPasswordRequestedSearchParams } from "./search-params";

describe("parseResetPasswordRequestedSearchParams", () => {
  it("keeps a well-formed email", () => {
    expect(
      parseResetPasswordRequestedSearchParams({ email: "user@example.com" })
    ).toEqual({ email: "user@example.com" });
  });

  it("hides a malformed email", () => {
    expect(
      parseResetPasswordRequestedSearchParams({ email: "not-an-email" })
    ).toEqual({ email: "" });
  });

  it("hides repeated or missing email params", () => {
    expect(
      parseResetPasswordRequestedSearchParams({
        email: ["a@example.com", "b@example.com"],
      })
    ).toEqual({ email: "" });
    expect(parseResetPasswordRequestedSearchParams({})).toEqual({ email: "" });
  });
});
