// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  WeeklySchedule,
  WeeklyScheduleDay,
  WeeklyScheduleDayPanel,
  WeeklyScheduleDays,
} from "./weekly-schedule";

const WEEKDAY_NAMES = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;

const renderSchedule = (defaultWeekday: number) =>
  render(
    <WeeklySchedule defaultWeekday={defaultWeekday}>
      <WeeklyScheduleDays aria-label="Update weekdays">
        {WEEKDAY_NAMES.map((name, weekday) => (
          <WeeklyScheduleDay key={name} weekday={weekday}>
            {name}
          </WeeklyScheduleDay>
        ))}
      </WeeklyScheduleDays>
      {WEEKDAY_NAMES.map((name, weekday) => (
        <WeeklyScheduleDayPanel key={name} weekday={weekday}>
          {name} shelf
        </WeeklyScheduleDayPanel>
      ))}
    </WeeklySchedule>
  );

afterEach(cleanup);

describe("WeeklySchedule", () => {
  // The day is decided where the tenant's time zone is known, so the strip has
  // to open on the one it is handed rather than on the first tab.
  it("opens on the weekday it is given", () => {
    renderSchedule(4);

    expect(
      screen.getByRole("tab", { name: "Thu" }).getAttribute("aria-selected")
    ).toBe("true");
    expect(screen.getByRole("tabpanel").textContent).toBe("Thu shelf");
  });

  it("opens on Sunday when Sunday is the weekday it is given", () => {
    renderSchedule(0);

    expect(
      screen.getByRole("tab", { name: "Sun" }).getAttribute("aria-selected")
    ).toBe("true");
    expect(screen.getByRole("tabpanel").textContent).toBe("Sun shelf");
  });

  it("shows another day's shelf once the reader picks that day", () => {
    renderSchedule(4);

    fireEvent.click(screen.getByRole("tab", { name: "Mon" }));

    expect(screen.getByRole("tabpanel").textContent).toBe("Mon shelf");
  });

  it("names the strip so a screen reader says what it switches between", () => {
    renderSchedule(4);

    expect(
      screen.getByRole("tablist", { name: "Update weekdays" })
    ).toBeDefined();
  });
});
