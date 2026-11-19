import { describe, expect, it } from "vitest";

import { isServerContainerOrigin } from "./google-tag-form-schemas";

describe("isServerContainerOrigin", () => {
  it.each([
    "https://sgtm.example.com",
    "https://sgtm.example.com/",
    "HTTPS://SGTM.Example.COM",
    "https://sgtm.example.com:8443",
    "https://タグ.example.jp",
  ])("accepts %s", (value) => {
    expect(isServerContainerOrigin(value)).toBe(true);
  });

  it.each([
    "http://sgtm.example.com",
    "https:sgtm.example.com",
    "https://sgtm.example.com/path",
    "https://sgtm.example.com?",
    "https://sgtm.example.com#",
    "https://user:pass@sgtm.example.com",
    "https://sgtm.example.com:",
    "https://sgtm.example.com:0",
    "https://localhost",
    "https://127.0.0.1",
    "https://127.1",
    "https://[::1]",
    "https://sgtm.example.com\\path",
  ])("refuses %s", (value) => {
    expect(isServerContainerOrigin(value)).toBe(false);
  });
});
