import { describe, expect, it } from "vitest";
import { z } from "zod";

import { cursorPageHref, cursorTokenSchema } from "./cursor-token";

describe("cursorTokenSchema", () => {
  it("不透明な token を変更せず返す", () => {
    const token = ` ${"x".repeat(256)} `;

    expect(cursorTokenSchema.parse(token)).toBe(token);
  });

  it("複数値や未指定の token を空値にする", () => {
    expect(cursorTokenSchema.parse(["first", "second"])).toBe("");
    expect(z.object({ token: cursorTokenSchema }).parse({})).toEqual({
      token: "",
    });
  });
});

describe("cursorPageHref", () => {
  it("token をクエリ文字列として安全にエスケープする", () => {
    expect(cursorPageHref("/operators", "next/page")).toBe(
      "/operators?token=next%2Fpage"
    );
  });

  it("token が空なら先頭ページへ戻す", () => {
    expect(cursorPageHref("/operators", "")).toBe("/operators");
  });
});
