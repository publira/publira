import { describe, expect, it } from "vitest";

import {
  episodeFreeWindowStatus,
  toFreeWindowPeriod,
} from "./free-window-period";

describe("toFreeWindowPeriod", () => {
  const now = Temporal.Instant.from("2026-10-04T12:00:00Z");

  it("passes an instant through, and reads a bare wall clock in the tenant's zone", async () => {
    expect(
      await toFreeWindowPeriod(
        { endsAt: "2026-10-05T09:00", startsAt: "2026-10-04T15:00:00Z" },
        "Asia/Tokyo",
        "en",
        now
      )
    ).toEqual({
      endsAt: "2026-10-05T00:00:00Z",
      ok: true,
      startsAt: "2026-10-04T15:00:00Z",
    });
  });

  it("allows a start that has already passed", async () => {
    expect(
      await toFreeWindowPeriod(
        { endsAt: "2026-10-05T00:00:00Z", startsAt: "2026-10-01T00:00:00Z" },
        "UTC",
        "en",
        now
      )
    ).toMatchObject({ ok: true });
  });

  it.each([
    ["an end before the start", "2026-10-06T00:00:00Z", "2026-10-05T00:00:00Z"],
    ["an end already passed", "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z"],
  ])("refuses %s", async (_name, startsAt, endsAt) => {
    expect(
      await toFreeWindowPeriod({ endsAt, startsAt }, "UTC", "en", now)
    ).toEqual({
      message: "Enter an end that is after the start and still in the future.",
      ok: false,
    });
  });

  it("asks for a start that is missing", async () => {
    expect(
      await toFreeWindowPeriod(
        { endsAt: "2026-10-05T00:00:00Z", startsAt: "" },
        "UTC",
        "en",
        now
      )
    ).toEqual({ message: "Enter when the period starts.", ok: false });
  });
});

describe("episodeFreeWindowStatus", () => {
  const window = {
    endsAt: "2026-10-05T00:00:00Z",
    startsAt: "2026-10-04T00:00:00Z",
  };

  it.each([
    ["scheduled", "2026-10-03T23:59:59Z"],
    ["open", "2026-10-04T00:00:00Z"],
    ["open", "2026-10-04T23:59:59Z"],
    // Half-open: the end instant is already outside the window.
    ["ended", "2026-10-05T00:00:00Z"],
  ])("reads as %s at %s", (status, at) => {
    expect(episodeFreeWindowStatus(window, Temporal.Instant.from(at))).toBe(
      status
    );
  });
});
