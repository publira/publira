import { describe, expect, it } from "vitest";

import {
  notificationsListHref,
  parseNotificationsSearchParams,
} from "./search-params";

describe("parseNotificationsSearchParams", () => {
  it("base64url の token は前後の空白だけ落として通す", () => {
    expect(parseNotificationsSearchParams({ token: " djF8Zg-_ " })).toEqual({
      token: "djF8Zg-_",
    });
  });

  it("token が無ければ先頭ページ扱いにする", () => {
    expect(parseNotificationsSearchParams({})).toEqual({ token: "" });
  });

  it("base64url 以外の token は捨てる", () => {
    expect(parseNotificationsSearchParams({ token: "djF8Zg==" })).toEqual({
      token: "",
    });
    expect(parseNotificationsSearchParams({ token: ["a", "b"] })).toEqual({
      token: "",
    });
  });
});

describe("notificationsListHref", () => {
  it("token 付きのクエリを組み立てる", () => {
    expect(notificationsListHref("next/page")).toBe(
      "/notifications?token=next%2Fpage"
    );
  });

  it("token が空なら先頭ページへ戻す", () => {
    expect(notificationsListHref("")).toBe("/notifications");
  });
});
