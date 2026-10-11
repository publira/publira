import { describe, expect, it } from "vitest";

import {
  creatorDetailHref,
  parseCreatorDetailSearchParams,
} from "./search-params";

// Token normalization itself is covered in `lib/cursor-token.test.ts`; these
// only pin down that this detail route is wired to it and points at the
// creator.
describe("parseCreatorDetailSearchParams", () => {
  it("The base64url token is passed by removing only the leading and trailing spaces.", () => {
    expect(parseCreatorDetailSearchParams({ token: " djF8Zg-_ " })).toEqual({
      token: "djF8Zg-_",
    });
  });

  it("If there is no token, treat it as the first page", () => {
    expect(parseCreatorDetailSearchParams({})).toEqual({ token: "" });
  });

  it("Discard tokens other than base64url", () => {
    expect(parseCreatorDetailSearchParams({ token: "djF8Zg==" })).toEqual({
      token: "",
    });
    expect(parseCreatorDetailSearchParams({ token: ["a", "b"] })).toEqual({
      token: "",
    });
  });
});

describe("creatorDetailHref", () => {
  it("Construct a query with token", () => {
    expect(creatorDetailHref("CREATOR_A", "djF8Zg")).toBe(
      "/creators/CREATOR_A?token=djF8Zg"
    );
  });

  it("If token is empty, return to first page", () => {
    expect(creatorDetailHref("CREATOR_A", "")).toBe("/creators/CREATOR_A");
  });
});
