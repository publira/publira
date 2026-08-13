import { describe, expect, it } from "vitest";

import { DEFAULT_TIME_ZONE } from "./format-date-time";
import { isValidTimeZone, listSupportedTimeZones } from "./time-zone";

describe("listSupportedTimeZones", () => {
  it("includes the default zone and other common IANA names", () => {
    const zones = listSupportedTimeZones();

    expect(zones).toContain(DEFAULT_TIME_ZONE);
    expect(zones).toContain("America/Los_Angeles");
    expect(zones).toContain("UTC");
  });

  it("is sorted by name and free of duplicates", () => {
    const zones = listSupportedTimeZones();

    expect([...zones]).toEqual(
      [...zones].toSorted((left, right) => left.localeCompare(right, "en"))
    );
    expect(new Set(zones).size).toBe(zones.length);
  });

  it("returns the same memoized list on repeated calls", () => {
    expect(listSupportedTimeZones()).toBe(listSupportedTimeZones());
  });

  it("only offers values the validator accepts", () => {
    expect(listSupportedTimeZones().every(isValidTimeZone)).toBe(true);
  });
});

describe("isValidTimeZone", () => {
  it("accepts IANA names, including aliases whose presence in the list depends on the ICU build", () => {
    expect(isValidTimeZone("Asia/Tokyo")).toBe(true);
    expect(isValidTimeZone("America/Argentina/Buenos_Aires")).toBe(true);
    expect(isValidTimeZone("Etc/GMT+9")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    // Deprecated link for Asia/Kolkata; still resolvable, like on the Go server.
    expect(isValidTimeZone("Asia/Calcutta")).toBe(true);
  });

  it("trims surrounding whitespace before validating", () => {
    expect(isValidTimeZone("  Asia/Tokyo  ")).toBe(true);
  });

  it("rejects empty and unknown names", () => {
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone("   ")).toBe(false);
    expect(isValidTimeZone("Asia/Nowhere")).toBe(false);
    expect(isValidTimeZone("JST")).toBe(false);
  });

  it("rejects `Local`, which means the server process zone rather than a tenant setting", () => {
    expect(isValidTimeZone("Local")).toBe(false);
    expect(isValidTimeZone("local")).toBe(false);
  });

  it("rejects offset zones that Temporal accepts but the Go server does not", () => {
    expect(isValidTimeZone("+09:00")).toBe(false);
    expect(isValidTimeZone("-08:00")).toBe(false);
  });
});
