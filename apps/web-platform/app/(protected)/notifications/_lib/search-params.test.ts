import { describe, expect, it } from "vitest";

import {
  buildNotificationsPath,
  parseNotificationsSearchParams,
} from "./search-params";

describe("parseNotificationsSearchParams", () => {
  it("cursor token を変更せず返す", () => {
    const token = ` ${"x".repeat(256)} `;

    expect(parseNotificationsSearchParams({ token })).toEqual({ token });
  });

  it("複数値や未指定の token を空値にする", () => {
    expect(
      parseNotificationsSearchParams({ token: ["first", "second"] })
    ).toEqual({
      token: "",
    });
    expect(parseNotificationsSearchParams({})).toEqual({ token: "" });
  });
});

describe("buildNotificationsPath", () => {
  it("ページ token を URL に保持する", () => {
    expect(buildNotificationsPath({ token: "next/page" })).toBe(
      "/notifications?token=next%2Fpage"
    );
  });

  it("token がなければ一覧のルートを返す", () => {
    expect(buildNotificationsPath({ token: "" })).toBe("/notifications");
  });
});
