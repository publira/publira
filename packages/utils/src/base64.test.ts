import { describe, expect, it } from "vitest";

import { decodeBase64Url } from "./base64";

describe("decodeBase64Url", () => {
  it("decodes unpadded Base64URL into bytes", () => {
    const value = decodeBase64Url("eyJzdWIiOiJyZWFkZXItcHVibGljLWlkIn0");
    if (!value) {
      throw new Error("expected the Base64URL value to decode");
    }

    expect(new TextDecoder().decode(value)).toBe('{"sub":"reader-public-id"}');
  });

  it.each(["a", "abcde", "abc===", "abc+/", "abc+_"])(
    "invalid Base64URL becomes null: %s",
    (value) => {
      expect(decodeBase64Url(value)).toBeNull();
    }
  );
});
