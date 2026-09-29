import { describe, expect, it } from "vitest";

import {
  buildOperatorsPath,
  parseOperatorsSearchParams,
} from "./search-params";

describe("parseOperatorsSearchParams", () => {
  it("returns the cursor token unchanged", () => {
    const token = ` ${"x".repeat(256)} `;

    expect(parseOperatorsSearchParams({ token })).toEqual({ token });
  });

  it("uses an empty value for multiple or missing tokens", () => {
    expect(parseOperatorsSearchParams({ token: ["first", "second"] })).toEqual({
      token: "",
    });
    expect(parseOperatorsSearchParams({})).toEqual({ token: "" });
  });
});

describe("buildOperatorsPath", () => {
  it("keeps the page token in the URL", () => {
    expect(buildOperatorsPath({ token: "next/page" })).toBe(
      "/operators?token=next%2Fpage"
    );
  });

  it("returns the list root when there is no token", () => {
    expect(buildOperatorsPath({ token: "" })).toBe("/operators");
  });
});
