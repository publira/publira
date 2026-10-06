import { describe, expect, it } from "vitest";

import { formatDuration } from "./format-duration";

describe("formatDuration", () => {
  it("words whole hours with the plural the locale needs", () => {
    expect(formatDuration({ hours: 1 }, { locale: "en" })).toBe("1 hour");
    expect(formatDuration({ hours: 23 }, { locale: "en" })).toBe("23 hours");
    expect(formatDuration({ hours: 72 }, { locale: "ja" })).toBe("72 時間");
  });

  it("writes hours and minutes side by side in the short style", () => {
    expect(
      formatDuration(
        { hours: 5, minutes: 12 },
        { locale: "en", style: "short" }
      )
    ).toBe("5 hr 12 min");
    expect(
      formatDuration(
        { hours: 5, minutes: 12 },
        { locale: "ko", style: "short" }
      )
    ).toBe("5시간 12분");
  });

  it("leaves a zero part out", () => {
    expect(
      formatDuration(
        { hours: 0, minutes: 40 },
        { locale: "en", style: "short" }
      )
    ).toBe("40 min");
    expect(
      formatDuration({ hours: 2, minutes: 0 }, { locale: "en", style: "short" })
    ).toBe("2 hr");
  });

  it("says zero minutes rather than nothing for an empty span", () => {
    expect(formatDuration({}, { locale: "en" })).toBe("0 minutes");
  });

  it("drops fractions and negative values", () => {
    expect(formatDuration({ hours: 1.9, minutes: -3 }, { locale: "en" })).toBe(
      "1 hour"
    );
  });
});
