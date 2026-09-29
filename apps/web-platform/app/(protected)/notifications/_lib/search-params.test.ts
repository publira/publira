import { describe, expect, it } from "vitest";

import {
  buildNotificationsPath,
  parseNotificationsSearchParams,
} from "./search-params";

describe("parseNotificationsSearchParams", () => {
  it("returns the cursor token unchanged", () => {
    const token = ` ${"x".repeat(256)} `;

    expect(parseNotificationsSearchParams({ token })).toEqual({ token });
  });

  it("uses an empty value for multiple or missing tokens", () => {
    expect(
      parseNotificationsSearchParams({ token: ["first", "second"] })
    ).toEqual({
      token: "",
    });
    expect(parseNotificationsSearchParams({})).toEqual({ token: "" });
  });
});

describe("buildNotificationsPath", () => {
  it("keeps the page token in the URL", () => {
    expect(buildNotificationsPath({ token: "next/page" })).toBe(
      "/notifications?token=next%2Fpage"
    );
  });

  it("returns the list root when there is no token", () => {
    expect(buildNotificationsPath({ token: "" })).toBe("/notifications");
  });
});
