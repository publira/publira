import { describe, expect, it } from "vitest";

import { readerIconPolicyClearance } from "./reader-icon-settings-shared";

describe("readerIconPolicyClearance", () => {
  it.each([
    ["upload", "none"],
    ["preset", "uploads"],
    ["disabled", "all"],
  ] as const)("saving %s may clear %s", (policy, clearance) => {
    expect(readerIconPolicyClearance(policy)).toBe(clearance);
  });
});
