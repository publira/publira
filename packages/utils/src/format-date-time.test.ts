import { describe, expect, it } from "vitest";

import {
  DEFAULT_TIME_ZONE,
  formatDateTime,
  fromDateTimeLocalValue,
  toDateTimeLocalValue,
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
    expect(formatDateTime(UTC_INSTANT, { timeZone: "Asia/Tokyo" })).toBe(
      "2024/03/10 19:00"
    );
    expect(
      formatDateTime(UTC_INSTANT, { timeZone: "America/Los_Angeles" })
    ).toBe("2024/03/10 3:00");
    expect(formatDateTime(UTC_INSTANT, { timeZone: "UTC" })).toBe(
      "2024/03/10 10:00"
    );
  });

  it("defaults timeZone to Asia/Tokyo when omitted", () => {
    expect(formatDateTime(UTC_INSTANT)).toBe("2024/03/10 19:00");
    expect(formatDateTime(UTC_INSTANT, { timeZone: DEFAULT_TIME_ZONE })).toBe(
      formatDateTime(UTC_INSTANT)
    );
  });

  it("accepts offset-bearing ISO strings", () => {
    expect(
      formatDateTime("2024-03-10T19:00:00+09:00", { timeZone: "Asia/Tokyo" })
    ).toBe("2024/03/10 19:00");
  });

  it("returns fallback for empty or invalid values", () => {
    expect(formatDateTime("", { fallback: "-" })).toBe("-");
    expect(formatDateTime("not-a-date", { fallback: "-" })).toBe("-");
    expect(formatDateTime("not-a-date")).toBe("not-a-date");
  });

  it("rejects zone-less timestamps (no host-local Date.parse)", () => {
    // Without Z/offset, Instant.from fails; must not interpret via host TZ.
    expect(formatDateTime("2024-03-10T10:00", { fallback: "-" })).toBe("-");
    expect(formatDateTime("2024-03-10T10:00:00", { fallback: "-" })).toBe("-");
    expect(formatDateTime("2024-03-10", { fallback: "-" })).toBe("-");
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
    expect(formatDateTime("2024-03-10T09:59:00Z", { timeZone: zone })).toBe(
      "2024/03/10 1:59"
    );
    // Just after (PDT, UTC-7): 2024-03-10T10:00:00Z → 03:00
    expect(formatDateTime("2024-03-10T10:00:00Z", { timeZone: zone })).toBe(
      "2024/03/10 3:00"
    );
  });
});
