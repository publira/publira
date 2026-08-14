import { describe, expect, it } from "vitest";

import { parseResetPasswordRequestedSearchParams } from "./search-params";

describe("parseResetPasswordRequestedSearchParams", () => {
  it("keeps a well-formed email and hides anything else", () => {
    expect(
      parseResetPasswordRequestedSearchParams({ email: "user@example.com" })
    ).toEqual({ email: "user@example.com" });
    expect(
      parseResetPasswordRequestedSearchParams({ email: "not-an-email" })
    ).toEqual({ email: "" });
  });
});
