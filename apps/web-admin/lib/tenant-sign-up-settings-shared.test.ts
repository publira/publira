import { describe, expect, it } from "vitest";

import { signUpClosedMessageLength } from "./tenant-sign-up-settings-shared";

describe("signUpClosedMessageLength", () => {
  it("counts the characters of the trimmed text", () => {
    expect(signUpClosedMessageLength("  Back soon.  ")).toBe(10);
  });

  it("counts an emoji as one character, as the server does", () => {
    expect(signUpClosedMessageLength("🌸")).toBe(1);
  });
});
