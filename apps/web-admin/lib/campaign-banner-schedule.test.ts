import { describe, expect, it } from "vitest";

import {
  campaignBannerStatus,
  isCampaignBannerLink,
  toCampaignBannerWindow,
} from "./campaign-banner-schedule";

const now = Temporal.Instant.from("2099-06-15T00:00:00Z");

describe("isCampaignBannerLink", () => {
  it.each([
    "/series/SERIES001",
    "/",
    "https://example.com/campaign",
    "http://example.com",
  ])("accepts %s", (link) => {
    expect(isCampaignBannerLink(link)).toBe(true);
  });

  it.each([
    // A browser reads both as another site.
    "//example.com/campaign",
    "/\\example.com",
    "series/SERIES001",
    "ftp://example.com/campaign",
    "mailto:someone@example.com",
    "https://",
  ])("refuses %s", (link) => {
    expect(isCampaignBannerLink(link)).toBe(false);
  });
});

describe("toCampaignBannerWindow", () => {
  it("passes the instants the form resolved through", async () => {
    await expect(
      toCampaignBannerWindow(
        { endsAt: "2099-07-01T00:00:00Z", startsAt: "2099-06-01T00:00:00Z" },
        { requireFutureEnd: true, timeZone: "Asia/Tokyo" },
        "en",
        now
      )
    ).resolves.toEqual({
      endsAt: "2099-07-01T00:00:00Z",
      ok: true,
      startsAt: "2099-06-01T00:00:00Z",
    });
  });

  it("reads a leftover wall clock in the tenant's zone", async () => {
    await expect(
      toCampaignBannerWindow(
        { endsAt: "2099-07-01T09:00", startsAt: "2099-06-01T09:00" },
        { requireFutureEnd: true, timeZone: "Asia/Tokyo" },
        "en",
        now
      )
    ).resolves.toEqual({
      endsAt: "2099-07-01T00:00:00Z",
      ok: true,
      startsAt: "2099-06-01T00:00:00Z",
    });
  });

  it("refuses an end that does not come after the start", async () => {
    await expect(
      toCampaignBannerWindow(
        { endsAt: "2099-06-01T00:00:00Z", startsAt: "2099-06-01T00:00:00Z" },
        { requireFutureEnd: false, timeZone: "Asia/Tokyo" },
        "en",
        now
      )
    ).resolves.toEqual({
      message: "The end has to come after the start and still be ahead.",
      ok: false,
    });
  });

  it("holds a new banner's end to the future", async () => {
    await expect(
      toCampaignBannerWindow(
        { endsAt: "2099-06-10T00:00:00Z", startsAt: "2099-06-01T00:00:00Z" },
        { requireFutureEnd: true, timeZone: "Asia/Tokyo" },
        "en",
        now
      )
    ).resolves.toMatchObject({ ok: false });
  });

  it("leaves an existing banner's past window to the API", async () => {
    await expect(
      toCampaignBannerWindow(
        { endsAt: "2099-06-10T00:00:00Z", startsAt: "2099-06-01T00:00:00Z" },
        { requireFutureEnd: false, timeZone: "Asia/Tokyo" },
        "en",
        now
      )
    ).resolves.toMatchObject({ ok: true });
  });

  it("names the missing end", async () => {
    await expect(
      toCampaignBannerWindow(
        { endsAt: "", startsAt: "2099-06-01T00:00:00Z" },
        { requireFutureEnd: true, timeZone: "Asia/Tokyo" },
        "en",
        now
      )
    ).resolves.toEqual({
      message: "Enter when the banner stops showing.",
      ok: false,
    });
  });
});

describe("campaignBannerStatus", () => {
  const window = {
    endsAt: "2099-07-01T00:00:00Z",
    startsAt: "2099-06-01T00:00:00Z",
  };

  it("shows a published banner inside its window", () => {
    expect(campaignBannerStatus({ ...window, published: true }, now)).toBe(
      "showing"
    );
  });

  it("never shows an unpublished banner, whatever its window", () => {
    expect(campaignBannerStatus({ ...window, published: false }, now)).toBe(
      "unpublished"
    );
  });

  it("has a banner whose window has not opened scheduled", () => {
    expect(
      campaignBannerStatus(
        { ...window, published: true },
        Temporal.Instant.from("2099-05-31T23:59:59Z")
      )
    ).toBe("scheduled");
  });

  it("has a banner ended at the very instant its window ends", () => {
    expect(
      campaignBannerStatus(
        { ...window, published: true },
        Temporal.Instant.from(window.endsAt)
      )
    ).toBe("ended");
  });
});
