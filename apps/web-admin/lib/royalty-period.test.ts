import { describe, expect, it } from "vitest";

import {
  closesAutomatically,
  currentRoyaltyPeriod,
  defaultOpenRoyaltyPeriod,
  isRoyaltyPeriodOver,
  royaltyCloseState,
  royaltyPeriodLastDay,
  scheduledRoyaltyCloseDate,
  shiftRoyaltyPeriod,
} from "./royalty-period";
import type { RoyaltyClosePolicy } from "./royalty-period";

const manual: RoyaltyClosePolicy = { automaticSince: "", closeMode: "manual" };

const automatic = (
  automaticSince: string,
  autoCloseDay = 5
): RoyaltyClosePolicy => ({
  autoCloseDay,
  automaticSince,
  closeMode: "automatic",
});

describe("currentRoyaltyPeriod", () => {
  it("counts the month in the tenant's zone, not in UTC", () => {
    const now = Temporal.Instant.from("2026-08-31T16:00:00Z");

    expect(currentRoyaltyPeriod("UTC", now)).toBe("2026-08");
    expect(currentRoyaltyPeriod("Asia/Tokyo", now)).toBe("2026-09");
  });
});

describe("shiftRoyaltyPeriod", () => {
  it("crosses a year in either direction", () => {
    expect(shiftRoyaltyPeriod("2026-12", 1)).toBe("2027-01");
    expect(shiftRoyaltyPeriod("2026-01", -1)).toBe("2025-12");
  });
});

describe("royaltyPeriodLastDay", () => {
  it("names the last day of a short month", () => {
    expect(royaltyPeriodLastDay("2028-02")).toBe("2028-02-29");
    expect(royaltyPeriodLastDay("2026-09")).toBe("2026-09-30");
  });
});

describe("isRoyaltyPeriodOver", () => {
  it("ends the month at midnight in the tenant's zone", () => {
    const period = "2026-08";

    expect(
      isRoyaltyPeriodOver(
        period,
        "Asia/Tokyo",
        Temporal.Instant.from("2026-08-31T14:59:59Z")
      )
    ).toBe(false);
    expect(
      isRoyaltyPeriodOver(
        period,
        "Asia/Tokyo",
        Temporal.Instant.from("2026-08-31T15:00:00Z")
      )
    ).toBe(true);
  });
});

describe("closesAutomatically", () => {
  it("is false for a manual tenant", () => {
    expect(closesAutomatically("2026-08", manual, "UTC")).toBe(false);
  });

  it("covers a month that ended after automatic closing was switched on", () => {
    expect(
      closesAutomatically("2026-08", automatic("2026-08-15T00:00:00Z"), "UTC")
    ).toBe(true);
  });

  it("leaves a month that ended before the switch to a person", () => {
    expect(
      closesAutomatically("2026-07", automatic("2026-08-15T00:00:00Z"), "UTC")
    ).toBe(false);
  });
});

describe("scheduledRoyaltyCloseDate", () => {
  it("is the chosen day of the following month", () => {
    expect(scheduledRoyaltyCloseDate("2026-12", 28)).toBe("2027-01-28");
  });
});

describe("defaultOpenRoyaltyPeriod", () => {
  it("opens last month for a tenant that has closed nothing", () => {
    expect(defaultOpenRoyaltyPeriod(undefined, "2026-09")).toBe("2026-08");
  });

  it("opens the month after the newest closed one", () => {
    expect(defaultOpenRoyaltyPeriod("2026-06", "2026-09")).toBe("2026-07");
  });

  it("stops at the current month", () => {
    expect(defaultOpenRoyaltyPeriod("2026-08", "2026-09")).toBe("2026-09");
  });
});

describe("royaltyCloseState", () => {
  const now = Temporal.Instant.from("2026-09-10T00:00:00Z");

  it("offers the close of a month that is over for a manual tenant", () => {
    expect(royaltyCloseState("2026-08", manual, "UTC", now)).toEqual({
      kind: "ready",
    });
  });

  it("says when a running month can be closed", () => {
    expect(royaltyCloseState("2026-09", manual, "UTC", now)).toEqual({
      kind: "in-progress",
      lastDay: "2026-09-30",
    });
  });

  it("names the automatic close date instead of offering the close", () => {
    const policy = automatic("2026-01-01T00:00:00Z", 5);

    expect(royaltyCloseState("2026-08", policy, "UTC", now)).toEqual({
      closeDate: "2026-09-05",
      kind: "automatic",
    });
    expect(royaltyCloseState("2026-09", policy, "UTC", now)).toEqual({
      closeDate: "2026-10-05",
      kind: "automatic",
    });
  });

  it("offers the close of a month automatic closing never covered", () => {
    const policy = automatic("2026-09-01T00:00:00Z");

    expect(royaltyCloseState("2026-07", policy, "UTC", now)).toEqual({
      kind: "ready",
    });
  });
});
