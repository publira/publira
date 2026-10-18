// @vitest-environment jsdom

import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithClientMessages } from "#lib/render-with-client-messages";

import { RentalTimeLeft } from "./rental-time-left";

vi.mock("#components/locale-context", () => ({
  useLocale: () => "en",
}));

describe("RentalTimeLeft", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("says how long the rental still opens the episode", async () => {
    const expiresAt = Temporal.Now.instant()
      .add({ hours: 47, minutes: 11, seconds: 30 })
      .toString();

    await renderWithClientMessages(<RentalTimeLeft expiresAt={expiresAt} />);

    expect(screen.getByText("47 hr 12 min left")).toBeDefined();
  });

  it("says nothing once the rental has run out", async () => {
    const spy = vi.spyOn(Temporal.Now, "instant");
    const start = Temporal.Instant.from("2026-10-05T12:00:00Z");
    spy.mockReturnValue(start);

    const { container } = await renderWithClientMessages(
      <RentalTimeLeft expiresAt="2026-10-05T12:00:30Z" />
    );
    expect(screen.getByText("1 min left")).toBeDefined();

    spy.mockReturnValue(start.add({ seconds: 30 }));
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(container.textContent).toBe("");
    spy.mockRestore();
  });
});
