import { describe, expect, it } from "vitest";

import {
  isEmailRejectionEntry,
  MAX_EMAIL_REJECTION_ENTRIES,
  parseEmailRejectionEntries,
  splitPastedEmailRejectionEntries,
} from "./tenant-email-rejection-settings-shared";

// The cases mirror server/internal/emailrejection: an entry the card accepts
// has to be one the server stores, and one it refuses one the server refuses.
describe("parseEmailRejectionEntries", () => {
  it("takes each entry trimmed, and skips blank ones", () => {
    expect(
      parseEmailRejectionEntries([
        "  Refused.Example ",
        "",
        " ",
        "someone@example.com",
      ])
    ).toEqual({
      entries: ["Refused.Example", "someone@example.com"],
      ok: true,
    });
  });

  it("accepts an empty list", () => {
    expect(parseEmailRejectionEntries([""])).toEqual({
      entries: [],
      ok: true,
    });
  });

  it.each([
    "example.com",
    "sub.example.co.jp",
    "EXAMPLE.COM",
    "example.com.",
    "xn--r8jz45g.jp",
    "例え.jp",
    "ＥＸＡＭＰＬＥ.com",
    "john@example.com",
    "john+tag@example.com",
    "first.last@example.com",
    "o'brien@example.com",
    "ユーザー@例え.jp",
    "a.b@example.com",
  ])("accepts %s", (entry) => {
    expect(isEmailRejectionEntry(entry)).toBe(true);
    expect(parseEmailRejectionEntries([entry]).ok).toBe(true);
  });

  it.each([
    ["a single label", "localhost"],
    ["a label starting with a hyphen", "-example.com"],
    ["a label ending with a hyphen", "example-.com"],
    ["hyphens in the third and fourth places", "ab--cd.com"],
    ["an empty label", "example..com"],
    ["an underscore", "under_score.example"],
    ["a space inside", "not a domain"],
    ["a path", "example.com/path"],
    ["a port", "example.com:25"],
    ["an address with no domain", "john@"],
    ["an address with no local part", "@example.com"],
    ["a local part that is only a tag", "+tag@example.com"],
    ["a local part with an empty atom", "john..doe@example.com"],
    ["a local part ending with a dot", "john.@example.com"],
    ["a quoted local part holding an @", '"a@b"@example.com'],
    ["an address on a single label", "john@localhost"],
    ["a label longer than 63 characters", `${"a".repeat(64)}.com`],
    ["a local part longer than 64 bytes", `${"a".repeat(65)}@example.com`],
    // The domain alone is 251 characters, which a domain may be.
    [
      "an entry longer than 254 bytes",
      `john@${Array.from({ length: 4 }, () => "a".repeat(61)).join(".")}.com`,
    ],
  ])("refuses %s", (_, entry) => {
    expect(isEmailRejectionEntry(entry)).toBe(false);
    expect(parseEmailRejectionEntries(["example.com", entry])).toEqual({
      entry: entry.trim(),
      ok: false,
      reason: "entry_invalid",
    });
  });

  it("counts the list after duplicates are dropped", () => {
    const domains = Array.from(
      { length: MAX_EMAIL_REJECTION_ENTRIES },
      (_, index) => `d${index}.example`
    );

    expect(
      parseEmailRejectionEntries([...domains, "D0.EXAMPLE", "d1.example."]).ok
    ).toBe(true);
    expect(
      parseEmailRejectionEntries([...domains, "one-more.example"])
    ).toEqual({ ok: false, reason: "too_many" });
  });
});

describe("splitPastedEmailRejectionEntries", () => {
  it("takes one entry a line, trimmed, whatever the line endings", () => {
    expect(
      splitPastedEmailRejectionEntries(
        "  one.example \r\n\r\ntwo@example.com\rthree.example\n\n"
      )
    ).toEqual(["one.example", "two@example.com", "three.example"]);
  });
});
