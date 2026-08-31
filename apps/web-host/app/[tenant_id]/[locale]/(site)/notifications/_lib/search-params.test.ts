import { describe, expect, it } from "vitest";

import {
  notificationsListHref,
  parseNotificationsSearchParams,
} from "./search-params";

describe("parseNotificationsSearchParams", () => {
  it("The base64url token is passed by removing only the leading and trailing spaces.", () => {
    expect(parseNotificationsSearchParams({ token: " djF8Zg-_ " })).toEqual({
      token: "djF8Zg-_",
    });
  });

  it("If there is no token, treat it as the first page", () => {
    expect(parseNotificationsSearchParams({})).toEqual({ token: "" });
  });

  it("Discard tokens other than base64url", () => {
    expect(parseNotificationsSearchParams({ token: "djF8Zg==" })).toEqual({
      token: "",
    });
    expect(parseNotificationsSearchParams({ token: ["a", "b"] })).toEqual({
      token: "",
    });
  });
});

describe("notificationsListHref", () => {
  it("Construct a query with token", () => {
    expect(notificationsListHref("next/page")).toBe(
      "/notifications?token=next%2Fpage"
    );
  });

  it("If token is empty, return to first page", () => {
    expect(notificationsListHref("")).toBe("/notifications");
  });
});
