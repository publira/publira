import { describe, expect, it } from "vitest";

import { toSafeAnnouncementLinkUrl } from "./announcement-link";

describe("toSafeAnnouncementLinkUrl", () => {
  it("keeps a path on this site and an absolute http(s) URL", () => {
    expect(toSafeAnnouncementLinkUrl("/series/S001")).toBe("/series/S001");
    expect(toSafeAnnouncementLinkUrl(" /pages/maintenance ")).toBe(
      "/pages/maintenance"
    );
    expect(toSafeAnnouncementLinkUrl("https://example.com/status")).toBe(
      "https://example.com/status"
    );
  });

  it("refuses the shapes a browser reads as another origin or as code", () => {
    expect(toSafeAnnouncementLinkUrl("//evil.example")).toBeNull();
    expect(toSafeAnnouncementLinkUrl("/\\evil.example")).toBeNull();
    expect(toSafeAnnouncementLinkUrl("mailto:ops@example.com")).toBeNull();
    // Assembled rather than written out, because `no-script-url` refuses the
    // literal even in the test that proves it is refused here too.
    expect(toSafeAnnouncementLinkUrl(`java${"script"}:alert(1)`)).toBeNull();
  });

  it("refuses an empty value and one longer than the column allows", () => {
    expect(toSafeAnnouncementLinkUrl("")).toBeNull();
    expect(toSafeAnnouncementLinkUrl("   ")).toBeNull();
    expect(toSafeAnnouncementLinkUrl(`/${"a".repeat(2048)}`)).toBeNull();
  });
});
