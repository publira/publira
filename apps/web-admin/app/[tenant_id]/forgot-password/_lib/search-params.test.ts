import { describe, expect, it } from "vitest";

import { parseForgotPasswordSearchParams } from "./search-params";

describe("parseForgotPasswordSearchParams", () => {
  it("reads an email and a requested flag", () => {
    expect(
      parseForgotPasswordSearchParams({
        email: "admin@example.com",
        error: "  Something went wrong  ",
        requested: "done",
      })
    ).toEqual({
      defaultEmail: "admin@example.com",
      errorMessage: "Something went wrong",
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
