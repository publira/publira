import { describe, expect, it } from "vitest";

import {
  isPurchaseAvailabilityOverride,
  resolvePurchaseAvailability,
} from "./purchase-availability";

describe("resolvePurchaseAvailability", () => {
  it("follows the level above where nothing is stated", () => {
    expect(resolvePurchaseAvailability("app", "")).toBe("app");
  });

  // Unlike where a work is shown, a stated value replaces the one above
  // rather than narrowing it: an episode may be sold where its series is not.
  it("replaces the level above with what is stated", () => {
    expect(resolvePurchaseAvailability("web", "app")).toBe("app");
    expect(resolvePurchaseAvailability("app", "all")).toBe("all");
  });
});

describe("isPurchaseAvailabilityOverride", () => {
  it("accepts following the level above and the three surfaces", () => {
    expect(
      ["", "all", "web", "app"].every(isPurchaseAvailabilityOverride)
    ).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isPurchaseAvailabilityOverride("everywhere")).toBe(false);
  });
});
