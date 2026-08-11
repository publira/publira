import { describe, expect, it } from "vitest";

import {
  notificationsListHref,
  parseNotificationsListSearchParams,
} from "./search-params";

// Token normalization itself is covered in `lib/cursor-token.test.ts`; these
// only pin down that this list is wired to it and points at `/notifications`.
describe("parseNotificationsListSearchParams", () => {
  it("base64url の token は前後の空白だけ落として通す", () => {
    expect(parseNotificationsListSearchParams({ token: " djF8Zg-_ " })).toEqual(
      {
        token: "djF8Zg-_",
      }
    );
  });

  it("token が無ければ先頭ページ扱いにする", () => {
    expect(parseNotificationsListSearchParams({})).toEqual({ token: "" });
  });

  it("base64url 以外の token は捨てる", () => {
    expect(parseNotificationsListSearchParams({ token: "djF8Zg==" })).toEqual({
      token: "",
    });
    expect(parseNotificationsListSearchParams({ token: ["a", "b"] })).toEqual({
      token: "",
    });
  });
});

describe("notificationsListHref", () => {
  it("token 付きのクエリを組み立てる", () => {
    expect(notificationsListHref("djF8Zg")).toBe("/notifications?token=djF8Zg");
  });

  it("token が空なら先頭ページへ戻す", () => {
    expect(notificationsListHref("")).toBe("/notifications");
  });
});
