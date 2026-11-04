import { describe, expect, it } from "vitest";

import { promotionCodeStatus } from "./promotion-code-shared";

const NOW = Temporal.Instant.from("2026-06-01T00:00:00Z");

const code = (
  overrides: Partial<{ endsAt: string; pausedAt: string; startsAt: string }>
) => ({ endsAt: "", pausedAt: "", startsAt: "", ...overrides });

describe("promotionCodeStatus", () => {
  it("is active with no window, and inside its window", () => {
    expect(promotionCodeStatus(code({}), NOW)).toBe("active");
    expect(
      promotionCodeStatus(
        code({
          endsAt: "2026-07-01T00:00:00Z",
          startsAt: "2026-05-01T00:00:00Z",
        }),
        NOW
      )
    ).toBe("active");
  });

  it("is scheduled before its start", () => {
    expect(
      promotionCodeStatus(code({ startsAt: "2026-06-01T00:00:01Z" }), NOW)
    ).toBe("scheduled");
  });

  it("has ended at the very instant it ends", () => {
    expect(
      promotionCodeStatus(code({ endsAt: "2026-06-01T00:00:00Z" }), NOW)
    ).toBe("ended");
  });

  it("is paused while paused, before or inside its window", () => {
    expect(
      promotionCodeStatus(code({ pausedAt: "2026-05-01T00:00:00Z" }), NOW)
    ).toBe("paused");
    expect(
      promotionCodeStatus(
        code({
          pausedAt: "2026-05-01T00:00:00Z",
          startsAt: "2026-07-01T00:00:00Z",
        }),
        NOW
      )
    ).toBe("paused");
  });

  it("has ended once past its end, paused or not", () => {
    expect(
      promotionCodeStatus(
        code({
          endsAt: "2026-05-01T00:00:00Z",
          pausedAt: "2026-04-01T00:00:00Z",
        }),
        NOW
      )
    ).toBe("ended");
  });
});
