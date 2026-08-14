import { describe, expect, it } from "vitest";

import { parseForgotPasswordSearchParams } from "./search-params";

describe("parseForgotPasswordSearchParams", () => {
  it("reads an email and a requested flag", () => {
    expect(
      parseForgotPasswordSearchParams({
        email: "admin@example.com",
        error: "  失敗しました  ",
        requested: "done",
      })
    ).toEqual({
      defaultEmail: "admin@example.com",
      errorMessage: "失敗しました",
      requested: true,
    });
  });

  it("drops a malformed email and an unknown requested value", () => {
    expect(
      parseForgotPasswordSearchParams({
        email: "not-an-email",
        requested: "yes",
      })
    ).toEqual({
      defaultEmail: "",
      errorMessage: undefined,
      requested: false,
    });
  });
});
