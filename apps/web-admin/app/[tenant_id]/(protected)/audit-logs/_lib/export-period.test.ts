import { describe, expect, it } from "vitest";

import { resolveAuditLogExportPeriod } from "./export-period";

const today = Temporal.PlainDate.from("2026-10-27");

describe("resolveAuditLogExportPeriod", () => {
  it("covers the days the filters name", () => {
    expect(
      resolveAuditLogExportPeriod(
        { from: "2026-01-01", to: "2026-01-31" },
        "UTC",
        today
      )
    ).toEqual({ end: "2026-01-31", ok: true, start: "2026-01-01" });
  });

  it("covers the longest period ending today when the list is not narrowed", () => {
    expect(
      resolveAuditLogExportPeriod({ from: "", to: "" }, "UTC", today)
    ).toEqual({ end: "2026-10-27", ok: true, start: "2025-10-27" });
  });

  it("ends today when only the start is named", () => {
    expect(
      resolveAuditLogExportPeriod({ from: "2026-04-01", to: "" }, "UTC", today)
    ).toEqual({ end: "2026-10-27", ok: true, start: "2026-04-01" });
  });

  it("ends on a start named after today rather than before it", () => {
    expect(
      resolveAuditLogExportPeriod({ from: "2026-11-02", to: "" }, "UTC", today)
    ).toEqual({ end: "2026-11-02", ok: true, start: "2026-11-02" });
  });

  it("starts the longest period before an end named alone", () => {
    expect(
      resolveAuditLogExportPeriod({ from: "", to: "2024-02-29" }, "UTC", today)
    ).toEqual({ end: "2024-02-29", ok: true, start: "2023-03-01" });
  });

  it.each([
    ["a reversed period", { from: "2026-02-01", to: "2026-01-31" }],
    ["a start before the longest period", { from: "2025-10-26", to: "" }],
    ["367 days", { from: "2025-01-01", to: "2026-01-02" }],
  ])("refuses %s", (_label, filters) => {
    expect(resolveAuditLogExportPeriod(filters, "UTC", today)).toEqual({
      ok: false,
    });
  });

  it("allows 366 days across a leap day", () => {
    expect(
      resolveAuditLogExportPeriod(
        { from: "2024-01-01", to: "2024-12-31" },
        "UTC",
        today
      )
    ).toEqual({ end: "2024-12-31", ok: true, start: "2024-01-01" });
  });
});
