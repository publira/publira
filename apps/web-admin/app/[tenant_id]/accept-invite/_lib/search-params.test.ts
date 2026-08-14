import { describe, expect, it } from "vitest";

import { parseAcceptInviteSearchParams } from "./search-params";

const VALID_TOKEN = "c".repeat(64);

describe("parseAcceptInviteSearchParams", () => {
  it("keeps a 64-char hex token", () => {
    expect(parseAcceptInviteSearchParams({ token: VALID_TOKEN })).toEqual({
      token: VALID_TOKEN,
    });
  });

  it("drops a missing or malformed token", () => {
    expect(parseAcceptInviteSearchParams({})).toEqual({ token: "" });
    expect(
      parseAcceptInviteSearchParams({ token: ["a".repeat(64), "b".repeat(64)] })
    ).toEqual({ token: "" });
  });
});
