import { describe, expect, it } from "vitest";

import { parsePeriodSearchParams, resolveAnalyticsPeriod } from "./period";

const today = Temporal.PlainDate.from("2026-10-25");

describe("parsePeriodSearchParams", () => {
  it("keeps calendar days and drops anything else", () => {
    expect(
      parsePeriodSearchParams({ from: "2026-02-30", to: "2026-10-01" })
    ).toEqual({ from: "", to: "2026-10-01" });
    expect(
      parsePeriodSearchParams({ from: ["2026-10-01", "2026-10-02"] })
    ).toEqual({ from: "", to: "" });
  });
});

describe("resolveAnalyticsPeriod", () => {
  it("covers the 28 days ending yesterday when the URL names none", () => {
    expect(resolveAnalyticsPeriod({ from: "", to: "" }, "UTC", today)).toEqual({
      end: "2026-10-24",
      ok: true,
      start: "2026-09-27",
    });
  });

  it("counts yesterday in the tenant's own zone", () => {
    // 2026-10-25T20:00Z is already the 26th in Tokyo.
    const now = Temporal.Instant.from("2026-10-25T20:00:00Z");
    const tokyoToday = now.toZonedDateTimeISO("Asia/Tokyo").toPlainDate();

    expect(
      resolveAnalyticsPeriod({ from: "", to: "" }, "Asia/Tokyo", tokyoToday).end
    ).toBe("2026-10-25");
  });

  it("takes the dates it is given", () => {
    expect(
      resolveAnalyticsPeriod(
        { from: "2026-01-01", to: "2026-01-31" },
        "UTC",
        today
      )
    ).toEqual({ end: "2026-01-31", ok: true, start: "2026-01-01" });
  });

  it("fills a missing start from the default length before the end", () => {
    expect(
      resolveAnalyticsPeriod({ from: "", to: "2026-03-28" }, "UTC", today)
    ).toMatchObject({ end: "2026-03-28", start: "2026-03-01" });
  });

  it("ends a period with no end yesterday, or on its start when that is later", () => {
    expect(
      resolveAnalyticsPeriod({ from: "2026-10-01", to: "" }, "UTC", today)
    ).toMatchObject({ end: "2026-10-24", ok: true });
    expect(
      resolveAnalyticsPeriod({ from: "2026-10-25", to: "" }, "UTC", today)
    ).toMatchObject({ end: "2026-10-25", ok: true, start: "2026-10-25" });
  });

  it("refuses a start after the end, keeping the dates for the form", () => {
    expect(
      resolveAnalyticsPeriod(
        { from: "2026-02-01", to: "2026-01-01" },
        "UTC",
        today
      )
    ).toEqual({
      end: "2026-01-01",
      ok: false,
      reason: "reversed",
      start: "2026-02-01",
    });
  });

  it("accepts 366 days and refuses one more", () => {
    expect(
      resolveAnalyticsPeriod(
        { from: "2024-01-01", to: "2024-12-31" },
        "UTC",
        today
      ).ok
    ).toBe(true);
    expect(
      resolveAnalyticsPeriod(
        { from: "2025-01-01", to: "2026-01-02" },
        "UTC",
        today
      )
    ).toMatchObject({ ok: false, reason: "too_long" });
  });
});
