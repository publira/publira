import { describe, expect, it } from "vitest";

import { previousMonth, reconciliationPeriodProblem } from "./period";

describe("previousMonth", () => {
  it.each([
    ["2026-11-02", "2026-10-01", "2026-10-31"],
    ["2026-03-01", "2026-02-01", "2026-02-28"],
    ["2024-03-15", "2024-02-01", "2024-02-29"],
    ["2026-01-31", "2025-12-01", "2025-12-31"],
  ])("starts the form on %s at the month before it", (today, start, end) => {
    expect(previousMonth(Temporal.PlainDate.from(today))).toEqual({
      endDate: end,
      startDate: start,
    });
  });
});

describe("reconciliationPeriodProblem", () => {
  it.each([
    ["one day", "2026-10-01", "2026-10-01"],
    ["366 days across a leap day", "2024-01-01", "2024-12-31"],
  ])("takes %s", (_label, startDate, endDate) => {
    expect(reconciliationPeriodProblem({ endDate, startDate })).toBeNull();
  });

  it("refuses a period that ends before it starts", () => {
    expect(
      reconciliationPeriodProblem({
        endDate: "2026-09-30",
        startDate: "2026-10-01",
      })
    ).toBe("reversed");
  });

  it("refuses 367 days", () => {
    expect(
      reconciliationPeriodProblem({
        endDate: "2026-01-02",
        startDate: "2025-01-01",
      })
    ).toBe("too_long");
  });
});
