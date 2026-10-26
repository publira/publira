import { describe, expect, it } from "vitest";

import { RETENTION_WEEKS, cohortCells, cohortShade } from "./cohorts";

describe("cohortCells", () => {
  it("shares each ended week over the cohort and leaves the rest open", () => {
    const cells = cohortCells({
      activeCounts: [4, 1],
      cohortSize: 4,
      weekStart: "2025-03-03",
    });

    expect(cells).toHaveLength(RETENTION_WEEKS);
    expect(cells.slice(0, 3)).toEqual([
      { share: 1, state: "counted", week: 0 },
      { share: 0.25, state: "counted", week: 1 },
      { state: "open", week: 2 },
    ]);
    expect(cells.at(-1)).toEqual({ state: "open", week: 12 });
  });

  it("has no share for a week nobody signed up in", () => {
    expect(
      cohortCells({
        activeCounts: [0],
        cohortSize: 0,
        weekStart: "2025-03-10",
      })[0]
    ).toEqual({ state: "no_readers", week: 0 });
  });
});

describe("cohortShade", () => {
  it("deepens with the share, up to its cap", () => {
    expect(cohortShade(0)).toBe(
      "color-mix(in oklab, var(--color-primary) 0%, transparent)"
    );
    expect(cohortShade(0.5)).toBe(
      "color-mix(in oklab, var(--color-primary) 20%, transparent)"
    );
    expect(cohortShade(1)).toBe(
      "color-mix(in oklab, var(--color-primary) 40%, transparent)"
    );
  });
});
