import { describe, expect, it } from "vitest";

import { buildQueryString } from "./query-string";

describe("buildQueryString", () => {
  it("空値のみの場合は空文字を返す", () => {
    expect(
      buildQueryString({
        action: "",
        actor: "   ",
        cursor: undefined,
      })
    ).toBe("");
  });

  it("trim した値のみをクエリ化する", () => {
    expect(
      buildQueryString({
        action: " series_created ",
        actor: " user_001 ",
      })
    ).toBe("?action=series_created&actor=user_001");
  });

  it("特殊文字を含む値をエンコードする", () => {
    expect(
      buildQueryString({
        actor: "Taro & Hanako",
      })
    ).toBe("?actor=Taro+%26+Hanako");
  });
});
