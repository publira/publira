import { describe, expect, it } from "vitest";
import { z } from "zod";

import { cursorPageHref, cursorTokenSchema } from "./cursor-token";

/**
 * Mirrors `pagination.Encode`: query-escape each key, join as
 * `v1|<dir>|<keys...>`, then unpadded base64url. Used only to pin the
 * length bound against a token the server would actually issue.
 */
const encodeLikeServer = (direction: "f" | "b", ...keys: string[]) => {
  const payload = ["v1", direction, ...keys.map(encodeURIComponent)].join("|");
  return Buffer.from(payload, "utf-8").toString("base64url");
};

describe("cursorTokenSchema", () => {
  it("The base64url token is passed by removing only the leading and trailing spaces.", () => {
    expect(cursorTokenSchema.parse(" djF8Zg-_ ")).toBe("djF8Zg-_");
  });

  it("If there is no token, treat it as the first page", () => {
    expect(cursorTokenSchema.parse("")).toBe("");
    expect(z.object({ token: cursorTokenSchema }).parse({})).toEqual({
      token: "",
    });
  });

  it("Discard tokens other than base64url, multiple values, and too long tokens", () => {
    expect(cursorTokenSchema.parse("djF8Zg==")).toBe("");
    expect(cursorTokenSchema.parse("v1|f|2026")).toBe("");
    expect(cursorTokenSchema.parse("dj F8Zg")).toBe("");
    expect(cursorTokenSchema.parse(["a", "b"])).toBe("");
    expect(cursorTokenSchema.parse("a".repeat(8196))).toBe("");
  });

  it("A regular token created from the author name and series title upper limit will be passed.", () => {
    const name = "あ".repeat(255);
    const emojiTitle = "😀".repeat(255);
    const id = "00000000-0000-0000-0000-000000000000";
    const nameToken = encodeLikeServer("f", name, id, "inclusive");
    const emojiToken = encodeLikeServer("f", emojiTitle, id, "inclusive");

    expect(nameToken.length).toBeGreaterThan(512);
    expect(emojiToken.length).toBeGreaterThan(512);
    expect(cursorTokenSchema.parse(nameToken)).toBe(nameToken);
    expect(cursorTokenSchema.parse(emojiToken)).toBe(emojiToken);
  });

  it("Discard tokens that are too long for base64url", () => {
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
  it("Construct a query with token", () => {
    expect(cursorPageHref("/series", "djF8Zg")).toBe("/series?token=djF8Zg");
  });

  it("If token is empty, return to first page", () => {
    expect(cursorPageHref("/series", "")).toBe("/series");
  });

  it("Safely escape token as a query string", () => {
    expect(cursorPageHref("/announcements", "a+b/c")).toBe(
      "/announcements?token=a%2Bb%2Fc"
    );
  });
});
