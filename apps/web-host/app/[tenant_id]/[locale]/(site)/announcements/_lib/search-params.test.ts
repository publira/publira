import { describe, expect, it } from "vitest";

import {
  announcementsListHref,
  parseAnnouncementsListSearchParams,
} from "./search-params";

// Token normalization itself is covered in `lib/cursor-token.test.ts`; these
// only pin down that this list is wired to it and points at `/announcements`.
describe("parseAnnouncementsListSearchParams", () => {
  it("The base64url token is passed by removing only the leading and trailing spaces.", () => {
    expect(parseAnnouncementsListSearchParams({ token: " djF8Zg-_ " })).toEqual(
      {
        token: "djF8Zg-_",
      }
    );
  });

  it("If there is no token, treat it as the first page", () => {
    expect(parseAnnouncementsListSearchParams({})).toEqual({ token: "" });
  });

  it("Discard tokens other than base64url", () => {
    expect(parseAnnouncementsListSearchParams({ token: "djF8Zg==" })).toEqual({
      token: "",
    });
    expect(parseAnnouncementsListSearchParams({ token: ["a", "b"] })).toEqual({
      token: "",
    });
  });
});

describe("announcementsListHref", () => {
  it("Construct a query with token", () => {
    expect(announcementsListHref("djF8Zg")).toBe("/announcements?token=djF8Zg");
  });

  it("If token is empty, return to first page", () => {
    expect(announcementsListHref("")).toBe("/announcements");
  });
});
