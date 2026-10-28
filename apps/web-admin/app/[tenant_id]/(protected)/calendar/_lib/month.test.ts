import { describe, expect, it } from "vitest";

import type { EpisodePublicationItem } from "#lib/publishing-calendar";

import {
  calendarMonthPeriod,
  calendarMonthWeeks,
  currentCalendarMonth,
  groupByDay,
  shiftCalendarMonth,
  todayIn,
} from "./month";

const episode = (
  episodePublicId: string,
  publishedAt: string
): EpisodePublicationItem => ({
  episodePublicId,
  episodeTitle: `Episode ${episodePublicId}`,
  publishedAt,
  seriesPublicId: "SR001",
  seriesTitle: "Series",
  status: "scheduled",
});

describe("todayIn and currentCalendarMonth", () => {
  // 2026-10-31 20:00 UTC is already November 1 in Tokyo.
  const now = Temporal.Instant.from("2026-10-31T20:00:00Z");

  it("reads the day in the given zone, not in UTC", () => {
    expect(todayIn("Asia/Tokyo", now)).toBe("2026-11-01");
    expect(todayIn("UTC", now)).toBe("2026-10-31");
  });

  it("reads the month in the given zone", () => {
    expect(currentCalendarMonth("Asia/Tokyo", now)).toBe("2026-11");
    expect(currentCalendarMonth("America/Los_Angeles", now)).toBe("2026-10");
  });
});

describe("shiftCalendarMonth", () => {
  it("crosses a year in either direction", () => {
    expect(shiftCalendarMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftCalendarMonth("2026-01", -1)).toBe("2025-12");
  });
});

describe("calendarMonthPeriod", () => {
  it("covers the whole month, February of a leap year included", () => {
    expect(calendarMonthPeriod("2028-02")).toEqual({
      endDate: "2028-02-29",
      startDate: "2028-02-01",
    });
    expect(calendarMonthPeriod("2026-10")).toEqual({
      endDate: "2026-10-31",
      startDate: "2026-10-01",
    });
  });
});

describe("calendarMonthWeeks", () => {
  it("starts the grid on Sunday and pads both ends", () => {
    // October 2026 starts on a Thursday and ends on a Saturday.
    const weeks = calendarMonthWeeks("2026-10");

    expect(weeks).toHaveLength(5);
    expect(weeks[0]).toEqual([
      null,
      null,
      null,
      null,
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
    ]);
    expect(weeks[4]).toEqual([
      "2026-10-25",
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
    ]);
  });

  it("needs no padding for a month that starts on Sunday", () => {
    // February 2026 starts on a Sunday and has exactly four weeks.
    const weeks = calendarMonthWeeks("2026-02");

    expect(weeks).toHaveLength(4);
    expect(weeks[0]?.[0]).toBe("2026-02-01");
    expect(weeks[3]?.[6]).toBe("2026-02-28");
  });

  it("pads the last row of a month that ends midweek", () => {
    // November 2026 ends on a Monday.
    const weeks = calendarMonthWeeks("2026-11");

    expect(weeks.at(-1)).toEqual([
      "2026-11-29",
      "2026-11-30",
      null,
      null,
      null,
      null,
      null,
    ]);
  });
});

describe("groupByDay", () => {
  it("puts each episode on the day its time falls on in the zone", () => {
    const days = groupByDay(
      [
        episode("EP1", "2026-10-31T14:59:00Z"),
        episode("EP2", "2026-10-31T15:00:00Z"),
        episode("EP3", "2026-10-31T23:00:00Z"),
      ],
      "Asia/Tokyo"
    );

    expect([...days.keys()]).toEqual(["2026-10-31", "2026-11-01"]);
    expect(days.get("2026-10-31")?.map((item) => item.episodePublicId)).toEqual(
      ["EP1"]
    );
    expect(days.get("2026-11-01")?.map((item) => item.episodePublicId)).toEqual(
      ["EP2", "EP3"]
    );
  });

  it("leaves out an episode whose time cannot be read", () => {
    const days = groupByDay(
      [episode("EP1", ""), episode("EP2", "2026-10-31T10:00")],
      "UTC"
    );

    expect(days.size).toBe(0);
  });
});
