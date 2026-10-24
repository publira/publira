import { describe, expect, it } from "vitest";

import { parseSiteVerificationCode } from "./tenant-site-verification-shared";

describe("parseSiteVerificationCode", () => {
  it("takes a bare code, trimmed and with its case kept", () => {
    expect(parseSiteVerificationCode("google", "  aBc-12_3 ")).toEqual({
      code: "aBc-12_3",
      ok: true,
    });
  });

  it("reads a blank value as clearing the code", () => {
    expect(parseSiteVerificationCode("bing", " \n ")).toEqual({
      code: "",
      ok: true,
    });
  });

  it.each([
    [
      "google",
      '<meta name="google-site-verification" content="aBc-12_3" />',
      "aBc-12_3",
    ],
    [
      "bing",
      '<meta name="msvalidate.01" content="0123456789ABCDEF" />',
      "0123456789ABCDEF",
    ],
    ["google", "<META CONTENT='aBc' NAME='Google-Site-Verification'>", "aBc"],
    ["bing", "<meta content=0123ABCD name=msvalidate.01>", "0123ABCD"],
    ["google", '<meta content=" aBc " />', "aBc"],
  ] as const)(
    "takes the content value of the %s element %s",
    (service, element, code) => {
      expect(parseSiteVerificationCode(service, element)).toEqual({
        code,
        ok: true,
      });
    }
  );

  it("refuses the element of the other service", () => {
    expect(
      parseSiteVerificationCode(
        "bing",
        '<meta name="google-site-verification" content="aBc" />'
      )
    ).toEqual({ ok: false, reason: "other_service" });
  });

  it.each([
    ["a space", "aBc 123"],
    ["a quote", 'aBc"'],
    ["an angle bracket", "<aBc"],
    ["a non-ASCII letter", "aBcé"],
    ["more than 128 characters", "a".repeat(129)],
    ["an element without a content value", '<meta name="msvalidate.01" />'],
    [
      "an element whose content is not a code",
      '<meta name="msvalidate.01" content="a b" />',
    ],
    ["another element", '<link rel="me" href="https://example.com" />'],
  ])("refuses a value with %s", (_, value) => {
    expect(parseSiteVerificationCode("bing", value)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("takes a code of exactly 128 characters", () => {
    const code = "a".repeat(128);
    expect(parseSiteVerificationCode("google", code)).toEqual({
      code,
      ok: true,
    });
  });
});
