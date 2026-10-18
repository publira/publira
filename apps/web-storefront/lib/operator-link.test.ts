import { describe, expect, it } from "vitest";

import { toSafeOperatorLinkUrl } from "./operator-link";

describe("toSafeOperatorLinkUrl", () => {
  it("keeps a path on this site and an absolute http(s) URL", () => {
    expect(toSafeOperatorLinkUrl("/series/S001")).toBe("/series/S001");
    expect(toSafeOperatorLinkUrl(" /pages/maintenance ")).toBe(
      "/pages/maintenance"
    );
    expect(toSafeOperatorLinkUrl("https://example.com/status")).toBe(
      "https://example.com/status"
    );
  });

  it("refuses the shapes a browser reads as another origin or as code", () => {
    expect(toSafeOperatorLinkUrl("//evil.example")).toBeNull();
    expect(toSafeOperatorLinkUrl("/\\evil.example")).toBeNull();
    expect(toSafeOperatorLinkUrl("mailto:ops@example.com")).toBeNull();
    // Assembled rather than written out, because `no-script-url` refuses the
    // literal even in the test that proves it is refused here too.
    expect(toSafeOperatorLinkUrl(`java${"script"}:alert(1)`)).toBeNull();
  });

  it("refuses an empty value and one longer than the column allows", () => {
    expect(toSafeOperatorLinkUrl("")).toBeNull();
    expect(toSafeOperatorLinkUrl("   ")).toBeNull();
    expect(toSafeOperatorLinkUrl(`/${"a".repeat(2048)}`)).toBeNull();
  });
});
