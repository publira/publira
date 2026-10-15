import { describe, expect, it } from "vitest";

import { readerIconPolicyClearance } from "./reader-icon-settings-shared";

describe("readerIconPolicyClearance", () => {
  it.each([
    ["upload", "preset", "uploads"],
    ["upload", "disabled", "all"],
    ["preset", "disabled", "all"],
    ["preset", "upload", "none"],
    ["disabled", "upload", "none"],
    ["disabled", "preset", "none"],
    ["upload", "upload", "none"],
    ["preset", "preset", "none"],
    ["disabled", "disabled", "none"],
  ] as const)("from %s to %s clears %s", (saved, next, clearance) => {
    expect(readerIconPolicyClearance(saved, next)).toBe(clearance);
  });
});
