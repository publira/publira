import { describe, expect, it } from "vitest";

import {
  resolveAuditLogExportPeriod,
  resolveAuditLogListPeriod,
} from "./period";

const today = Temporal.PlainDate.from("2026-10-27");

describe("resolveAuditLogListPeriod", () => {
  it("reaches from the start of the first day to the start of the day after the last", () => {
    expect(
      resolveAuditLogListPeriod(
        { createdFrom: "2026-01-10", createdTo: "2026-01-11" },
        "Asia/Tokyo"
      )
    ).toEqual({
      createdFrom: "2026-01-09T15:00:00Z",
      createdTo: "2026-01-11T15:00:00Z",
    });
  });

  it("leaves an end that is not named open", () => {
    expect(
      resolveAuditLogListPeriod({ createdFrom: "", createdTo: "" }, "UTC")
    ).toEqual({ createdFrom: undefined, createdTo: undefined });
  });

  it("ends on a day the clocks change at the next midnight of that zone", () => {
    expect(
      resolveAuditLogListPeriod(
        { createdFrom: "2026-03-08", createdTo: "2026-03-08" },
        "America/New_York"
      )
    ).toEqual({
      createdFrom: "2026-03-08T05:00:00Z",
      createdTo: "2026-03-09T04:00:00Z",
    });
  });
});

describe("resolveAuditLogExportPeriod", () => {
  it("covers the days the filters name", () => {
    expect(
      resolveAuditLogExportPeriod(
        { createdFrom: "2026-01-01", createdTo: "2026-01-31" },
        "UTC",
        today
      )
    ).toEqual({ end: "2026-01-31", ok: true, start: "2026-01-01" });
  });

  it("covers the longest period ending today when the list is not narrowed", () => {
    expect(
      resolveAuditLogExportPeriod(
        { createdFrom: "", createdTo: "" },
        "UTC",
        today
      )
    ).toEqual({ end: "2026-10-27", ok: true, start: "2025-10-27" });
  });

  it("ends today when only the start is named", () => {
    expect(
      resolveAuditLogExportPeriod(
        { createdFrom: "2026-04-01", createdTo: "" },
        "UTC",
        today
      )
    ).toEqual({ end: "2026-10-27", ok: true, start: "2026-04-01" });
  });

  it("ends on a start named after today rather than before it", () => {
    expect(
      resolveAuditLogExportPeriod(
        { createdFrom: "2026-11-02", createdTo: "" },
        "UTC",
        today
      )
    ).toEqual({ end: "2026-11-02", ok: true, start: "2026-11-02" });
  });

  it("starts the longest period before an end named alone", () => {
    expect(
      resolveAuditLogExportPeriod(
        { createdFrom: "", createdTo: "2024-02-29" },
        "UTC",
        today
      )
    ).toEqual({ end: "2024-02-29", ok: true, start: "2023-03-01" });
  });

  it.each([
    [
      "a reversed period",
      { createdFrom: "2026-02-01", createdTo: "2026-01-31" },
    ],
    [
      "a start before the longest period",
      { createdFrom: "2025-10-26", createdTo: "" },
    ],
    ["367 days", { createdFrom: "2025-01-01", createdTo: "2026-01-02" }],
  ])("refuses %s", (_label, filters) => {
    expect(resolveAuditLogExportPeriod(filters, "UTC", today)).toEqual({
      ok: false,
    });
  });

  it("allows 366 days across a leap day", () => {
    expect(
      resolveAuditLogExportPeriod(
        { createdFrom: "2024-01-01", createdTo: "2024-12-31" },
        "UTC",
        today
      )
    ).toEqual({ end: "2024-12-31", ok: true, start: "2024-01-01" });
  });
});
