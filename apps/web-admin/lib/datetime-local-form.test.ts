// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { fillInstantFromDateTimeLocal } from "./datetime-local-form";

describe("fillInstantFromDateTimeLocal", () => {
  it("converts the wall clock to an absolute instant in the time zone on screen", () => {
    const form = document.createElement("form");
    const local = document.createElement("input");
    local.name = "publish_at_local";
    local.value = "2099-06-01T10:00";
    const iso = document.createElement("input");
    iso.name = "publish_at";
    form.append(local, iso);

    fillInstantFromDateTimeLocal(form, {
      isoName: "publish_at",
      localName: "publish_at_local",
      timeZone: "America/Los_Angeles",
    });

    // PDT (UTC-7) in June — 10:00 in Los Angeles is 17:00Z.
    expect(iso.value).toBe("2099-06-01T17:00:00Z");
  });

  it("turns an empty wall clock into an empty string", () => {
    const form = document.createElement("form");
    const local = document.createElement("input");
    local.name = "publish_at_local";
    local.value = "";
    const iso = document.createElement("input");
    iso.name = "publish_at";
    iso.value = "stale";
    form.append(local, iso);

    fillInstantFromDateTimeLocal(form, {
      isoName: "publish_at",
      localName: "publish_at_local",
      timeZone: "Asia/Tokyo",
    });

    expect(iso.value).toBe("");
  });
});
