import { describe, expect, it } from "vitest";

import { minutesUntil } from "./minutes-until";

const now = Temporal.Instant.from("2026-10-05T12:00:00Z");

describe("minutesUntil", () => {
  it("rounds a part of a minute up, so the countdown never reads zero early", () => {
    expect(minutesUntil("2026-10-05T12:00:01Z", now)).toBe(1);
    expect(minutesUntil("2026-10-05T17:12:00Z", now)).toBe(312);
  });

  it("is zero once the instant has passed", () => {
    expect(minutesUntil("2026-10-05T12:00:00Z", now)).toBe(0);
    expect(minutesUntil("2026-10-05T11:00:00Z", now)).toBe(0);
  });

  it("is null for a value that is not an instant", () => {
    expect(minutesUntil("", now)).toBeNull();
    expect(minutesUntil("tomorrow", now)).toBeNull();
  });
});
