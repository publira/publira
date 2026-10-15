import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("GET /.well-known/change-password", () => {
  it("sends the operator to the password reset screen with a temporary redirect", () => {
    const response = GET();

    expect(response.status).toBe(302);
    expect(
      new URL(
        response.headers.get("Location") ?? "",
        "https://platform.example.com/.well-known/change-password"
      ).href
    ).toBe("https://platform.example.com/reset-password");
  });
});
