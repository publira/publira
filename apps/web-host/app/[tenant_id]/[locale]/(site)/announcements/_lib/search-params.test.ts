import { describe, expect, it } from "vitest";

import {
  announcementsListHref,
  parseAnnouncementsListSearchParams,
} from "./search-params";

// Token normalization itself is covered in `lib/cursor-token.test.ts`; these
// only pin down that this list is wired to it and points at `/announcements`.
describe("parseAnnouncementsListSearchParams", () => {
  it("base64url の token は前後の空白だけ落として通す", () => {
    expect(parseAnnouncementsListSearchParams({ token: " djF8Zg-_ " })).toEqual(
      {
        token: "djF8Zg-_",
      }
    );
  });

  it("token が無ければ先頭ページ扱いにする", () => {
    expect(parseAnnouncementsListSearchParams({})).toEqual({ token: "" });
  });

  it("base64url 以外の token は捨てる", () => {
    expect(parseAnnouncementsListSearchParams({ token: "djF8Zg==" })).toEqual({
      token: "",
    });
    expect(parseAnnouncementsListSearchParams({ token: ["a", "b"] })).toEqual({
      token: "",
    });
  });
});

describe("announcementsListHref", () => {
  it("token 付きのクエリを組み立てる", () => {
    expect(announcementsListHref("djF8Zg")).toBe("/announcements?token=djF8Zg");
  });

  it("token が空なら先頭ページへ戻す", () => {
    expect(announcementsListHref("")).toBe("/announcements");
  });
});
