import { describe, expect, it } from "vitest";

import { decodeBase64Url } from "./base64";

describe("decodeBase64Url", () => {
  it("パディングなしの Base64URL をバイト列へ復号する", () => {
    const value = decodeBase64Url("eyJzdWIiOiJyZWFkZXItcHVibGljLWlkIn0");
    if (!value) {
      throw new Error("Base64URL の復号に失敗しました。");
    }

    expect(new TextDecoder().decode(value)).toBe('{"sub":"reader-public-id"}');
  });

  it.each(["a", "abcde", "abc===", "abc+_"])(
    "不正な Base64URL を null にする: %s",
    (value) => {
      expect(decodeBase64Url(value)).toBeNull();
    }
  );
});
