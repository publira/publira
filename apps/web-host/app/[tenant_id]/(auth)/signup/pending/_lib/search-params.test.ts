import { describe, expect, it } from "vitest";

import { parseSignupPendingSearchParams } from "./search-params";

describe("parseSignupPendingSearchParams", () => {
  it("keeps a well-formed email and hides anything else", () => {
    expect(
      parseSignupPendingSearchParams({ email: "user@example.com" })
    ).toEqual({ email: "user@example.com" });
    expect(parseSignupPendingSearchParams({})).toEqual({ email: "" });
  });
});
