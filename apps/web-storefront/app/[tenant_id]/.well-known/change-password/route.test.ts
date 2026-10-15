import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("GET /.well-known/change-password", () => {
  it("sends the reader to the security settings on the host they asked with a temporary redirect", () => {
    const response = GET();

    expect(response.status).toBe(302);
    expect(
      new URL(
        response.headers.get("Location") ?? "",
        "https://shop.example.test/.well-known/change-password"
      ).href
    ).toBe("https://shop.example.test/settings/security");
  });
});
