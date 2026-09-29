import { describe, expect, it } from "vitest";
import { z } from "zod";

import { cursorPageHref, cursorTokenSchema } from "./cursor-token";

describe("cursorTokenSchema", () => {
  it("returns opaque tokens unchanged", () => {
    const token = ` ${"x".repeat(256)} `;

    expect(cursorTokenSchema.parse(token)).toBe(token);
  });

  it("uses an empty value for multiple or missing tokens", () => {
    expect(cursorTokenSchema.parse(["first", "second"])).toBe("");
    expect(z.object({ token: cursorTokenSchema }).parse({})).toEqual({
      token: "",
    });
  });
});

describe("cursorPageHref", () => {
  it("safely escapes tokens for query strings", () => {
    expect(cursorPageHref("/operators", "next/page")).toBe(
      "/operators?token=next%2Fpage"
    );
  });

  it("returns to the first page when the token is empty", () => {
    expect(cursorPageHref("/operators", "")).toBe("/operators");
  });
});
