import { describe, expect, it } from "vitest";

import {
  DEFAULT_TIME_ZONE,
  endOfDayIsoString,
  formatDate,
  formatDateTime,
  formatPlainDate,
  fromDateTimeLocalValue,
  parseInstant,
  startOfDayIsoString,
  toDateTimeLocalValue,
  toInstantIsoString,
} from "./format-date-time";

/** Fixed UTC instant used across multi-zone display tests. */
const UTC_INSTANT = "2024-03-10T10:00:00.000Z";

describe("DEFAULT_TIME_ZONE", () => {
  it("is Asia/Tokyo for gradual migration from the previous fixed zone", () => {
    expect(DEFAULT_TIME_ZONE).toBe("Asia/Tokyo");
  });
});

describe("formatDateTime", () => {
  it("formats the same UTC instant differently per IANA time zone", () => {
    // 10:00 UTC → 19:00 JST, 03:00 PDT (America/Los_Angeles, UTC-7 in March)
    expect(
      formatDateTime(UTC_INSTANT, { locale: "ja", timeZone: "Asia/Tokyo" })
    ).toBe("2024/03/10 19:00");
    expect(
      formatDateTime(UTC_INSTANT, {
        locale: "ja",
        timeZone: "America/Los_Angeles",
      })
    ).toBe("2024/03/10 3:00");
    expect(formatDateTime(UTC_INSTANT, { locale: "ja", timeZone: "UTC" })).toBe(
      "2024/03/10 10:00"
    );
  });

  it("defaults timeZone to Asia/Tokyo when omitted", () => {
    expect(formatDateTime(UTC_INSTANT, { locale: "ja" })).toBe(
      "2024/03/10 19:00"
    );
    expect(
      formatDateTime(UTC_INSTANT, { locale: "ja", timeZone: DEFAULT_TIME_ZONE })
    ).toBe(formatDateTime(UTC_INSTANT, { locale: "ja" }));
  });

  it("accepts offset-bearing ISO strings", () => {
    expect(
      formatDateTime("2024-03-10T19:00:00+09:00", {
        locale: "ja",
        timeZone: "Asia/Tokyo",
      })
    ).toBe("2024/03/10 19:00");
  });

  it("returns fallback for empty or invalid values", () => {
    expect(formatDateTime("", { fallback: "-", locale: "ja" })).toBe("-");
    expect(formatDateTime("not-a-date", { fallback: "-", locale: "ja" })).toBe(
      "-"
    );
    expect(formatDateTime("not-a-date", { locale: "ja" })).toBe("not-a-date");
  });

  it("rejects zone-less timestamps (no host-local Date.parse)", () => {
    // Without Z/offset, Instant.from fails; must not interpret via host TZ.
    expect(
      formatDateTime("2024-03-10T10:00", { fallback: "-", locale: "ja" })
    ).toBe("-");
    expect(
      formatDateTime("2024-03-10T10:00:00", { fallback: "-", locale: "ja" })
    ).toBe("-");
    expect(formatDateTime("2024-03-10", { fallback: "-", locale: "ja" })).toBe(
      "-"
    );
  });

  it("uses the UI locale for Intl instead of a fixed ja-JP", () => {
    const instant = parseInstant(UTC_INSTANT);
    if (!instant) {
      throw new Error("expected UTC_INSTANT to parse");
    }

    const ja = formatDateTime(UTC_INSTANT, { locale: "ja", timeZone: "UTC" });
    const en = formatDateTime(UTC_INSTANT, { locale: "en", timeZone: "UTC" });

    expect(ja).toBe("2024/03/10 10:00");
    expect(en).not.toBe(ja);
    expect(en).toBe(
      new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(instant.epochMilliseconds)
    );
  });
});

describe("formatDate", () => {
  it("uses the calendar day of the given zone, not the UTC day", () => {
    // 2024-03-10T23:00Z is already 2024-03-11 in Tokyo and still 03-10 in LA.
    const lateInstant = "2024-03-10T23:00:00.000Z";
    expect(
      formatDate(lateInstant, { locale: "ja", timeZone: "Asia/Tokyo" })
    ).toBe("2024/03/11");
    expect(
      formatDate(lateInstant, { locale: "ja", timeZone: "America/Los_Angeles" })
    ).toBe("2024/03/10");
    expect(formatDate(lateInstant, { locale: "ja", timeZone: "UTC" })).toBe(
      "2024/03/10"
    );
  });

  it("defaults timeZone to Asia/Tokyo when omitted", () => {
    expect(formatDate(UTC_INSTANT, { locale: "ja" })).toBe("2024/03/10");
  });

  it("returns fallback for empty or invalid values", () => {
    expect(formatDate("", { fallback: "-", locale: "ja" })).toBe("-");
    expect(formatDate("not-a-date", { fallback: "-", locale: "ja" })).toBe("-");
    expect(formatDate("2024-03-10", { fallback: "-", locale: "ja" })).toBe("-");
  });

  it("uses the UI locale for Intl instead of a fixed ja-JP", () => {
    const lateInstant = "2024-03-10T23:00:00.000Z";
    const instant = parseInstant(lateInstant);
    if (!instant) {
      throw new Error("expected lateInstant to parse");
    }

    const ja = formatDate(lateInstant, { locale: "ja", timeZone: "UTC" });
    const en = formatDate(lateInstant, { locale: "en", timeZone: "UTC" });

    expect(ja).toBe("2024/03/10");
    expect(en).not.toBe(ja);
    expect(en).toBe(
      new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(instant.epochMilliseconds)
    );
  });
});

describe("parseInstant", () => {
  it("parses offset-bearing timestamps to the same instant", () => {
    const utc = parseInstant(UTC_INSTANT);
    const jst = parseInstant("2024-03-10T19:00:00+09:00");
    expect(utc).not.toBeNull();
    expect(jst).not.toBeNull();
    expect(
      Temporal.Instant.compare(utc as Temporal.Instant, jst as Temporal.Instant)
    ).toBe(0);
  });

  it("orders instants regardless of the offset they were written with", () => {
    const earlier = parseInstant(
      "2024-03-10T19:00:00+09:00"
    ) as Temporal.Instant;
    const later = parseInstant("2024-03-10T12:00:00Z") as Temporal.Instant;
    // Lexicographic string comparison would get this backwards.
    expect(Temporal.Instant.compare(earlier, later)).toBe(-1);
  });

  it("returns null for empty, zone-less, or invalid values", () => {
    expect(parseInstant("")).toBeNull();
    expect(parseInstant("   ")).toBeNull();
    expect(parseInstant("not-a-date")).toBeNull();
    expect(parseInstant("2024-03-10T10:00")).toBeNull();
    expect(parseInstant("2024-03-10")).toBeNull();
  });
});

describe("toInstantIsoString", () => {
  it("passes absolute timestamps through, normalized to UTC", () => {
    expect(toInstantIsoString(UTC_INSTANT, "Asia/Tokyo")).toBe(
      "2024-03-10T10:00:00Z"
    );
    expect(toInstantIsoString("2024-03-10T19:00:00+09:00", "UTC")).toBe(
      "2024-03-10T10:00:00Z"
    );
  });

  it("interprets zone-less wall clocks in the given zone, not the host zone", () => {
    expect(toInstantIsoString("2024-03-10T19:00", "Asia/Tokyo")).toBe(
      "2024-03-10T10:00:00Z"
    );
    expect(toInstantIsoString("2024-03-10T03:00", "America/Los_Angeles")).toBe(
      "2024-03-10T10:00:00Z"
    );
    expect(toInstantIsoString("2024-03-10T19:00:30", "Asia/Tokyo")).toBe(
      "2024-03-10T10:00:30Z"
    );
  });

  it("returns empty string for empty or unparseable values", () => {
    expect(toInstantIsoString("", "Asia/Tokyo")).toBe("");
    expect(toInstantIsoString("   ", "Asia/Tokyo")).toBe("");
    expect(toInstantIsoString("not-a-date", "Asia/Tokyo")).toBe("");
    expect(toInstantIsoString("2024-03-10", "Asia/Tokyo")).toBe("");
  });
});

describe("date-only day boundaries", () => {
  it("brackets the calendar day of the given zone", () => {
    expect(startOfDayIsoString("2024-03-10", "Asia/Tokyo")).toBe(
      "2024-03-09T15:00:00Z"
    );
    expect(endOfDayIsoString("2024-03-10", "Asia/Tokyo")).toBe(
      "2024-03-10T14:59:59.999999999Z"
    );
    expect(startOfDayIsoString("2024-03-10", "UTC")).toBe(
      "2024-03-10T00:00:00Z"
    );
    expect(endOfDayIsoString("2024-03-10", "UTC")).toBe(
      "2024-03-10T23:59:59.999999999Z"
    );
  });

  it("keeps the end strictly after the start on a 23-hour DST day", () => {
    // 2024-03-10 in America/Los_Angeles loses an hour to spring-forward.
    const start = startOfDayIsoString("2024-03-10", "America/Los_Angeles");
    const end = endOfDayIsoString("2024-03-10", "America/Los_Angeles");
    expect(start).toBe("2024-03-10T08:00:00Z");
    expect(end).toBe("2024-03-11T06:59:59.999999999Z");
    expect(
      Temporal.Instant.compare(
        parseInstant(start) as Temporal.Instant,
        parseInstant(end) as Temporal.Instant
      )
    ).toBe(-1);
  });

  it("covers the full 25-hour fall-back day", () => {
    expect(startOfDayIsoString("2024-11-03", "America/Los_Angeles")).toBe(
      "2024-11-03T07:00:00Z"
    );
    expect(endOfDayIsoString("2024-11-03", "America/Los_Angeles")).toBe(
      "2024-11-04T07:59:59.999999999Z"
    );
  });

  it("ends the day immediately before the next day starts", () => {
    const end = parseInstant(
      endOfDayIsoString("2024-03-10", "Asia/Tokyo")
    ) as Temporal.Instant;
    const nextStart = parseInstant(
      startOfDayIsoString("2024-03-11", "Asia/Tokyo")
    ) as Temporal.Instant;
    expect(nextStart.since(end).total({ unit: "nanosecond" })).toBe(1);
  });

  it("includes sub-microsecond instants at the very end of the day", () => {
    // A coarser end (…:59.999999Z) would drop these; the helper must not assume
    // the consumer stores only microseconds.
    const end = parseInstant(
      endOfDayIsoString("2024-03-10", "UTC")
    ) as Temporal.Instant;
    for (const value of [
      "2024-03-10T23:59:59.999999Z",
      "2024-03-10T23:59:59.999999001Z",
      "2024-03-10T23:59:59.999999999Z",
    ]) {
      const at = parseInstant(value) as Temporal.Instant;
      expect(Temporal.Instant.compare(at, end)).toBeLessThanOrEqual(0);
    }
  });

  it("returns empty string for empty or non date-only input", () => {
    for (const input of [
      "",
      "   ",
      "not-a-date",
      "2024-03-10T00:00",
      "2024-13-40",
    ]) {
      expect(startOfDayIsoString(input, "Asia/Tokyo")).toBe("");
      expect(endOfDayIsoString(input, "Asia/Tokyo")).toBe("");
    }
  });
});

describe("toDateTimeLocalValue", () => {
  it("converts an absolute instant to datetime-local wall clock in the given zone", () => {
    expect(toDateTimeLocalValue(UTC_INSTANT, "Asia/Tokyo")).toBe(
      "2024-03-10T19:00"
    );
    expect(toDateTimeLocalValue(UTC_INSTANT, "America/Los_Angeles")).toBe(
      "2024-03-10T03:00"
    );
    expect(toDateTimeLocalValue(UTC_INSTANT, "UTC")).toBe("2024-03-10T10:00");
  });

  it("does not depend on the host local time zone", () => {
    // Same absolute + same IANA zone must be stable under any process TZ.
    expect(
      toDateTimeLocalValue("2024-07-01T00:00:00Z", "Pacific/Auckland")
    ).toBe("2024-07-01T12:00");
  });

  it("returns fallback for empty or invalid values", () => {
    expect(toDateTimeLocalValue("", "Asia/Tokyo")).toBe("");
    expect(toDateTimeLocalValue("bogus", "Asia/Tokyo")).toBe("");
    expect(toDateTimeLocalValue("bogus", "Asia/Tokyo", { fallback: "—" })).toBe(
      "—"
    );
  });

  it("rejects zone-less timestamps (no host-local Date.parse)", () => {
    expect(toDateTimeLocalValue("2024-03-10T10:00", "Asia/Tokyo")).toBe("");
    expect(toDateTimeLocalValue("2024-03-10T10:00:00", "UTC")).toBe("");
    expect(
      toDateTimeLocalValue("2024-03-10T10:00", "UTC", { fallback: "—" })
    ).toBe("—");
  });
});

describe("fromDateTimeLocalValue", () => {
  it("converts datetime-local wall clock + IANA zone to a UTC instant", () => {
    expect(fromDateTimeLocalValue("2024-03-10T19:00", "Asia/Tokyo")).toBe(
      "2024-03-10T10:00:00Z"
    );
    expect(
      fromDateTimeLocalValue("2024-03-10T03:00", "America/Los_Angeles")
    ).toBe("2024-03-10T10:00:00Z");
    expect(fromDateTimeLocalValue("2024-03-10T10:00", "UTC")).toBe(
      "2024-03-10T10:00:00Z"
    );
  });

  it("accepts optional seconds in the wall-clock string", () => {
    expect(fromDateTimeLocalValue("2024-03-10T19:00:30", "Asia/Tokyo")).toBe(
      "2024-03-10T10:00:30Z"
    );
  });

  it("round-trips with toDateTimeLocalValue", () => {
    const zones = ["Asia/Tokyo", "America/Los_Angeles", "Europe/London", "UTC"];
    for (const timeZone of zones) {
      const local = toDateTimeLocalValue(UTC_INSTANT, timeZone);
      const back = fromDateTimeLocalValue(local, timeZone);
      // Minute precision: original has :00 seconds
      expect(back).toBe("2024-03-10T10:00:00Z");
      expect(toDateTimeLocalValue(back, timeZone)).toBe(local);
    }
  });

  it("returns empty string for empty or invalid input", () => {
    expect(fromDateTimeLocalValue("", "Asia/Tokyo")).toBe("");
    expect(fromDateTimeLocalValue("   ", "Asia/Tokyo")).toBe("");
    expect(fromDateTimeLocalValue("not-a-datetime", "Asia/Tokyo")).toBe("");
    expect(fromDateTimeLocalValue("2024-13-40T99:99", "Asia/Tokyo")).toBe("");
  });

  it("rejects Z, numeric offsets, and time-zone annotations", () => {
    // PlainDateTime.from would ignore +09:00 / [Asia/Tokyo]; must not.
    expect(fromDateTimeLocalValue("2024-03-10T19:00Z", "Asia/Tokyo")).toBe("");
    expect(fromDateTimeLocalValue("2024-03-10T19:00+09:00", "Asia/Tokyo")).toBe(
      ""
    );
    expect(
      fromDateTimeLocalValue("2024-03-10T19:00-07:00", "America/Los_Angeles")
    ).toBe("");
    expect(
      fromDateTimeLocalValue("2024-03-10T19:00[Asia/Tokyo]", "Asia/Tokyo")
    ).toBe("");
    expect(
      fromDateTimeLocalValue("2024-03-10T19:00+09:00[Asia/Tokyo]", "Asia/Tokyo")
    ).toBe("");
  });
});

describe("DST boundaries (America/Los_Angeles)", () => {
  const zone = "America/Los_Angeles";

  it("spring-forward: non-existent local time is disambiguated (compatible)", () => {
    // 2024-03-10: clocks jump 02:00 → 03:00 PDT. 02:30 does not exist.
    // Temporal compatible maps the gap forward to 03:30 PDT = 10:30Z.
    const iso = fromDateTimeLocalValue("2024-03-10T02:30", zone);
    expect(iso).toBe("2024-03-10T10:30:00Z");
    expect(toDateTimeLocalValue(iso, zone)).toBe("2024-03-10T03:30");
  });

  it("fall-back: ambiguous local time uses compatible (earlier) instant", () => {
    // 2024-11-03: clocks fall back 02:00 → 01:00. 01:30 occurs twice.
    // compatible prefers the earlier occurrence (PDT, -07:00) = 08:30Z.
    const iso = fromDateTimeLocalValue("2024-11-03T01:30", zone);
    expect(iso).toBe("2024-11-03T08:30:00Z");
    expect(toDateTimeLocalValue(iso, zone)).toBe("2024-11-03T01:30");
  });

  it("formats instants correctly on both sides of spring-forward", () => {
    // Just before transition (still PST, UTC-8): 2024-03-10T09:59:00Z → 01:59
    expect(
      formatDateTime("2024-03-10T09:59:00Z", { locale: "ja", timeZone: zone })
    ).toBe("2024/03/10 1:59");
    // Just after (PDT, UTC-7): 2024-03-10T10:00:00Z → 03:00
    expect(
      formatDateTime("2024-03-10T10:00:00Z", { locale: "ja", timeZone: zone })
    ).toBe("2024/03/10 3:00");
  });
});

describe("formatPlainDate", () => {
  it("renders the calendar day it was given, whatever the host zone", () => {
    expect(formatPlainDate("2026-03-14", { locale: "ja" })).toBe("2026/03/14");
  });

  it("uses the UI locale rather than a fixed one", () => {
    const ja = formatPlainDate("2026-03-14", { locale: "ja" });
    const en = formatPlainDate("2026-03-14", { locale: "en" });

    expect(en).not.toBe(ja);
  });

  it("returns fallback for a value that is not a calendar day", () => {
    expect(formatPlainDate("", { fallback: "-", locale: "ja" })).toBe("-");
    expect(formatPlainDate("2026-03", { fallback: "-", locale: "ja" })).toBe(
      "-"
    );
    expect(
      formatPlainDate("2026-03-14T00:00:00Z", { fallback: "-", locale: "ja" })
    ).toBe("-");
  });

  it("falls back to the original value when no fallback is given", () => {
    expect(formatPlainDate("not-a-date", { locale: "ja" })).toBe("not-a-date");
  });
});
