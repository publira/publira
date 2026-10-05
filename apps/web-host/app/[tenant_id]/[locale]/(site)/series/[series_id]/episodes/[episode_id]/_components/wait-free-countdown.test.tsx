// @vitest-environment jsdom

import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithClientMessages } from "#lib/render-with-client-messages";

import { minutesUntil, WaitFreeCountdown } from "./wait-free-countdown";

vi.mock("#components/locale-context", () => ({
  useLocale: () => "en",
}));

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

describe("WaitFreeCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("counts down in hours and minutes", async () => {
    const nextAvailableAt = Temporal.Now.instant()
      .add({ hours: 5, minutes: 11, seconds: 30 })
      .toString();

    await renderWithClientMessages(
      <WaitFreeCountdown
        absolute="Mon, Oct 5, 5:12 PM"
        nextAvailableAt={nextAvailableAt}
      >
        <button type="submit">Use</button>
      </WaitFreeCountdown>
    );

    expect(
      screen.getByText("Your next free ticket is ready in 5 hr 12 min.")
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: "Use" })).toBeNull();
  });

  it("offers the ticket once the clock reaches it", async () => {
    const spy = vi.spyOn(Temporal.Now, "instant");
    const start = Temporal.Instant.from("2026-10-05T12:00:00Z");
    spy.mockReturnValue(start);

    await renderWithClientMessages(
      <WaitFreeCountdown
        absolute="Mon, Oct 5, 12:00 PM"
        nextAvailableAt="2026-10-05T12:00:30Z"
      >
        <button type="submit">Use</button>
      </WaitFreeCountdown>
    );

    expect(
      screen.getByText("Your next free ticket is ready in 1 min.")
    ).toBeDefined();

    spy.mockReturnValue(start.add({ seconds: 30 }));
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByRole("button", { name: "Use" })).toBeDefined();
    spy.mockRestore();
  });

  it("states the instant when there is nothing to count down to", async () => {
    await renderWithClientMessages(
      <WaitFreeCountdown absolute="" nextAvailableAt="not an instant">
        <button type="submit">Use</button>
      </WaitFreeCountdown>
    );

    expect(
      screen.getByText("Your next free ticket is ready on .")
    ).toBeDefined();
  });
});
