import { describe, expect, it } from "vitest";
import { z } from "zod";

import { cursorPageHref, cursorTokenSchema } from "./cursor-token";

describe("cursorTokenSchema", () => {
  it("base64url の token は前後の空白だけ落として通す", () => {
    expect(cursorTokenSchema.parse(" djF8Zg-_ ")).toBe("djF8Zg-_");
  });

  it("token が無ければ先頭ページ扱いにする", () => {
    expect(cursorTokenSchema.parse("")).toBe("");
    expect(z.object({ token: cursorTokenSchema }).parse({})).toEqual({
      token: "",
    });
  });

  it("base64url 以外・複数値・長すぎる token は捨てる", () => {
    expect(cursorTokenSchema.parse("djF8Zg==")).toBe("");
    expect(cursorTokenSchema.parse("v1|f|2026")).toBe("");
    expect(cursorTokenSchema.parse("dj F8Zg")).toBe("");
    expect(cursorTokenSchema.parse(["a", "b"])).toBe("");
    expect(cursorTokenSchema.parse("a".repeat(513))).toBe("");
  });

  it("base64url が取り得ない長さの token は捨てる", () => {
    // 4 で割った余りが 1 になる長さは、パディング無し base64url では作れない。
    expect(cursorTokenSchema.parse("a")).toBe("");
    expect(cursorTokenSchema.parse("abcde")).toBe("");
    // 余り 0 / 2 / 3 は正当な長さなので通す。
    expect(cursorTokenSchema.parse("ab")).toBe("ab");
    expect(cursorTokenSchema.parse("abc")).toBe("abc");
    expect(cursorTokenSchema.parse("abcd")).toBe("abcd");
  });
});

describe("cursorPageHref", () => {
  it("token 付きのクエリを組み立てる", () => {
    expect(cursorPageHref("/series", "djF8Zg")).toBe("/series?token=djF8Zg");
  });

  it("token が空なら先頭ページへ戻す", () => {
    expect(cursorPageHref("/series", "")).toBe("/series");
  });

  it("token をクエリ文字列として安全にエスケープする", () => {
    expect(cursorPageHref("/announcements", "a+b/c")).toBe(
      "/announcements?token=a%2Bb%2Fc"
    );
  });
});
