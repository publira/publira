import { describe, expect, it } from "vitest";

import { parseLoginSearchParams } from "./search-params";

describe("parseLoginSearchParams", () => {
  it("keeps a same-origin next path and a reset flag", () => {
    expect(
      parseLoginSearchParams({ next: "/operators", reset: "done" })
    ).toEqual({
      nextPath: "/operators",
      passwordResetDone: true,
    });
  });

  it("neutralizes an open redirect and ignores an unknown reset value", () => {
    expect(
      parseLoginSearchParams({
        next: "https://evil.example",
        reset: "nope",
      })
    ).toEqual({
      nextPath: "/",
      passwordResetDone: false,
    });
  });
});
