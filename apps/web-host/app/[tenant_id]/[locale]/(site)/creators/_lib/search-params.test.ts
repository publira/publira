import { describe, expect, it } from "vitest";

import {
  creatorsListHref,
  parseCreatorsListSearchParams,
} from "./search-params";

// Token normalization itself is covered in `lib/cursor-token.test.ts`; these
// only pin down that this list is wired to it and points at `/creators`.
describe("parseCreatorsListSearchParams", () => {
  it("The base64url token is passed by removing only the leading and trailing spaces.", () => {
    expect(parseCreatorsListSearchParams({ token: " djF8Zg-_ " })).toEqual({
      token: "djF8Zg-_",
    });
  });

  it("If there is no token, treat it as the first page", () => {
    expect(parseCreatorsListSearchParams({})).toEqual({ token: "" });
  });

  it("Discard tokens other than base64url", () => {
    expect(parseCreatorsListSearchParams({ token: "djF8Zg==" })).toEqual({
      token: "",
    });
    expect(parseCreatorsListSearchParams({ token: ["a", "b"] })).toEqual({
      token: "",
    });
  });
});

describe("creatorsListHref", () => {
  it("Construct a query with token", () => {
    expect(creatorsListHref("djF8Zg")).toBe("/creators?token=djF8Zg");
  });

  it("If token is empty, return to first page", () => {
    expect(creatorsListHref("")).toBe("/creators");
  });
});
