import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockCreateSeries,
  mockGetAccessToken,
  mockGetTenantDisplayTimeZone,
  mockRedirect,
  mockUpdateSeries,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockCreateSeries: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetTenantDisplayTimeZone: vi.fn(),
  mockRedirect: vi.fn(),
  mockUpdateSeries: vi.fn(),
  mockUpdateTag: vi.fn(),
}));

vi.mock("#lib/action-messages", async () => {
  const { bindMessages } = await import("@publira/i18n");
  const { sharedCatalog } = await import("@publira/i18n/catalog");
  return {
    getActionLocale: () => Promise.resolve("en"),
    getActionMessages: () => Promise.resolve(bindMessages(sharedCatalog("en"))),
  };
});

vi.mock("next/cache", () => ({
  updateTag: mockUpdateTag,
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/dashboard", () => ({
  tenantDashboardCacheTag: (tenantId: string) => `tenant:${tenantId}:dashboard`,
}));

vi.mock("#lib/session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("#lib/series", () => ({
  createSeries: mockCreateSeries,
  seriesCacheTag: (tenantId: string, publicId: string) =>
    `series-${tenantId}-${publicId}`,
  seriesListCacheTag: (tenantId: string) => `series-list-${tenantId}`,
  updateSeries: mockUpdateSeries,
}));

vi.mock("#lib/tenant-timezone", () => ({
  getTenantDisplayTimeZone: mockGetTenantDisplayTimeZone,
}));

describe("series actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetTenantDisplayTimeZone.mockResolvedValue("Asia/Tokyo");
    // `withAdminSessionReauth` resolves the session before the mutation runs;
    // without a token every Action under test would redirect to /login.
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("updating the basics calls the update API even when no image is chosen", async () => {
    mockUpdateSeries.mockResolvedValueOnce({
      ok: true,
      series: {
        creatorCredits: [],
        creatorNames: [],
        eyeCatchImageUpdatedAt: "",
        eyeCatchImageVariants: [],
        isPublished: true,
        labelName: "Label",
        labelPublicId: "LABEL001",
        publicId: "SERIES001",
        readingPeriodHours: 24,
        synopsis: "A synopsis",
        title: "Series title",
      },
    });

    const { updateSeriesAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("public_id", "SERIES001");
    formData.set("title", "Series title");
    formData.set("synopsis", "A synopsis");
    formData.set("reading_period_hours", "24");
    formData.set("label_public_id", "LABEL001");
    formData.set("status", "ongoing");
    formData.set("age_rating", "all");
    formData.set("comment_mode", "");
    formData.set("reading_direction", "rtl");
    formData.set("spread_start_page", "2");
    formData.set("published_at", "2030-01-01T10:00");
    formData.set("clear_eye_catch_image", "0");

    await updateSeriesAction(null, formData);

    expect(mockUpdateSeries).toHaveBeenCalledWith(
      {
        ageRating: "all",
        commentMode: "",
        creatorCredits: [],
        eyeCatchImageContentType: undefined,
        eyeCatchImageData: undefined,
        genrePublicIds: [],
        isPublished: true,
        labelPublicId: "LABEL001",
        publicId: "SERIES001",
        // "2030-01-01T10:00" is a zone-less wall clock, read in the tenant zone
        // (Asia/Tokyo here) — never as the server process's local zone.
        publishedAt: "2030-01-01T01:00:00Z",
        readingDirection: "rtl",
        readingPeriodHours: 24,
        scheduleWeekdays: [],
        spreadStartIndex: 1,
        status: "ongoing",
        synopsis: "A synopsis",
        tagNames: [],
        tenantId: "TENANT001",
        title: "Series title",
      },
      "en"
    );
    expect(mockRedirect).toHaveBeenCalledWith("/series/SERIES001?updated=1");
  });

  it("updating the basics sends an offset-bearing published_at as the same instant", async () => {
    mockUpdateSeries.mockResolvedValueOnce({
      ok: true,
      series: {
        creatorCredits: [],
        creatorNames: [],
        eyeCatchImageUpdatedAt: "",
        eyeCatchImageVariants: [],
        isPublished: true,
        labelName: "Label",
        labelPublicId: "LABEL001",
        publicId: "SERIES001",
        readingPeriodHours: 24,
        synopsis: "A synopsis",
        title: "Series title",
      },
    });

    const { updateSeriesAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("public_id", "SERIES001");
    formData.set("title", "Series title");
    formData.set("synopsis", "A synopsis");
    formData.set("reading_period_hours", "24");
    formData.set("label_public_id", "LABEL001");
    formData.set("status", "ongoing");
    formData.set("age_rating", "all");
    formData.set("comment_mode", "");
    formData.set("reading_direction", "rtl");
    formData.set("spread_start_page", "2");
    formData.set("published_at", "2030-01-01T10:00:00-08:00");

    await updateSeriesAction(null, formData);

    expect(mockUpdateSeries).toHaveBeenCalledWith(
      expect.objectContaining({ publishedAt: "2030-01-01T18:00:00Z" }),
      "en"
    );
  });

  it("updating the basics reads the datetime-local wall clock in the tenant time zone", async () => {
    mockGetTenantDisplayTimeZone.mockResolvedValue("America/Los_Angeles");
    mockUpdateSeries.mockResolvedValueOnce({
      ok: true,
      series: {
        creatorCredits: [],
        creatorNames: [],
        eyeCatchImageUpdatedAt: "",
        eyeCatchImageVariants: [],
        isPublished: true,
        labelName: "Label",
        labelPublicId: "LABEL001",
        publicId: "SERIES001",
        readingPeriodHours: 24,
        synopsis: "A synopsis",
        title: "Series title",
      },
    });

    const { updateSeriesAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("public_id", "SERIES001");
    formData.set("title", "Series title");
    formData.set("synopsis", "A synopsis");
    formData.set("reading_period_hours", "24");
    formData.set("label_public_id", "LABEL001");
    formData.set("status", "ongoing");
    formData.set("age_rating", "all");
    formData.set("comment_mode", "");
    formData.set("reading_direction", "rtl");
    formData.set("spread_start_page", "2");
    formData.set("published_at", "2030-01-01T10:00");

    await updateSeriesAction(null, formData);

    // PST (UTC-8) in January — 10:00 in Los Angeles is 18:00Z.
    expect(mockUpdateSeries).toHaveBeenCalledWith(
      expect.objectContaining({ publishedAt: "2030-01-01T18:00:00Z" }),
      "en"
    );
    expect(mockGetTenantDisplayTimeZone).toHaveBeenCalledWith("TENANT001");
    // The screen has no client-side refresh of its own, so clearing this tag is
    // what puts the saved series back on the page.
    expect(mockUpdateTag).toHaveBeenCalledWith("series-TENANT001-SERIES001");
    // And clearing the list tag is what puts it back on `/series`, which reads
    // its rows from a cache entry the per-series tag does not reach.
    expect(mockUpdateTag).toHaveBeenCalledWith("series-list-TENANT001");
    // The dashboard counts published series and names the series each queued
    // episode belongs to, so a publish or a retitle changes what it shows.
    expect(mockUpdateTag).toHaveBeenCalledWith("tenant:TENANT001:dashboard");
  });

  it("updating the basics rejects a published_at that cannot be read as a date and time", async () => {
    const { updateSeriesAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("public_id", "SERIES001");
    formData.set("title", "Series title");
    formData.set("synopsis", "A synopsis");
    formData.set("reading_period_hours", "24");
    formData.set("label_public_id", "LABEL001");
    formData.set("status", "ongoing");
    formData.set("age_rating", "all");
    formData.set("comment_mode", "");
    formData.set("reading_direction", "rtl");
    formData.set("spread_start_page", "2");
    formData.set("published_at", "2030-01-01");

    const result = await updateSeriesAction(null, formData);

    expect(result).toEqual({
      message: "The publication date and time is invalid.",
      mode: "update",
      ok: false,
    });
    expect(mockUpdateSeries).not.toHaveBeenCalled();
  });

  it("updating the cover image returns an error when neither an image nor a removal is given", async () => {
    const { updateSeriesEyeCatchAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("public_id", "SERIES001");
    formData.set("title", "Series title");
    formData.set("synopsis", "A synopsis");
    formData.set("reading_period_hours", "24");
    formData.set("label_public_id", "LABEL001");
    formData.set("status", "ongoing");
    formData.set("age_rating", "all");
    formData.set("comment_mode", "");
    formData.set("reading_direction", "rtl");
    formData.set("spread_start_page", "2");
    formData.set("clear_eye_catch_image", "0");

    const result = await updateSeriesEyeCatchAction(null, formData);

    expect(result).toEqual({
      message: "Select an image or choose to remove it.",
      mode: "update",
      ok: false,
    });
    expect(mockUpdateSeries).not.toHaveBeenCalled();
  });

  it("creating a series clears the list tag so the new row is on /series at once", async () => {
    mockCreateSeries.mockResolvedValueOnce({
      ok: true,
      series: {
        creatorCredits: [],
        creatorNames: [],
        eyeCatchImageUpdatedAt: "",
        eyeCatchImageVariants: [],
        isPublished: false,
        labelName: "Label",
        labelPublicId: "LABEL001",
        publicId: "SERIES001",
        readingPeriodHours: 24,
        synopsis: "A synopsis",
        title: "Series title",
      },
    });

    const { createSeriesAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("title", "Series title");
    formData.set("synopsis", "A synopsis");
    formData.set("reading_period_hours", "24");
    formData.set("label_public_id", "LABEL001");
    formData.set("status", "ongoing");
    formData.set("age_rating", "all");
    formData.set("comment_mode", "");
    formData.set("reading_direction", "rtl");
    formData.set("spread_start_page", "2");

    await createSeriesAction(null, formData);

    expect(mockUpdateTag).toHaveBeenCalledWith("series-list-TENANT001");
    expect(mockUpdateTag).toHaveBeenCalledWith("tenant:TENANT001:dashboard");
    expect(mockRedirect).toHaveBeenCalledWith("/series/SERIES001?created=1");
  });

  it("sends the classification the form posted", async () => {
    mockCreateSeries.mockResolvedValueOnce({
      ok: true,
      series: { publicId: "SERIES001" },
    });

    const { createSeriesAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("title", "Series title");
    formData.set("synopsis", "A synopsis");
    formData.set("reading_period_hours", "24");
    formData.set("label_public_id", "LABEL001");
    formData.set("status", "hiatus");
    formData.set("age_rating", "r18");
    formData.set("comment_mode", "");
    formData.set("reading_direction", "rtl");
    formData.set("spread_start_page", "2");
    formData.append("schedule_weekdays", "5");
    formData.append("schedule_weekdays", "1");
    formData.append("genre_public_ids", "GENRE001");
    formData.append("genre_public_ids", "GENRE002");
    formData.append("tag_names", " Fantasy ");
    formData.append("tag_names", "");

    await createSeriesAction(null, formData);

    expect(mockCreateSeries).toHaveBeenCalledWith(
      expect.objectContaining({
        ageRating: "r18",
        genrePublicIds: ["GENRE001", "GENRE002"],
        // Ascending, so the stored schedule does not depend on the order the
        // checkboxes happened to be ticked in.
        scheduleWeekdays: [1, 5],
        status: "hiatus",
        tagNames: ["Fantasy"],
      }),
      "en"
    );
  });

  it("drops a weekday that is not one of the seven", async () => {
    mockCreateSeries.mockResolvedValueOnce({
      ok: true,
      series: { publicId: "SERIES001" },
    });

    const { createSeriesAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("title", "Series title");
    formData.set("synopsis", "A synopsis");
    formData.set("reading_period_hours", "24");
    formData.set("label_public_id", "LABEL001");
    formData.set("status", "ongoing");
    formData.set("age_rating", "all");
    formData.set("comment_mode", "");
    formData.set("reading_direction", "rtl");
    formData.set("spread_start_page", "2");
    formData.append("schedule_weekdays", "7");
    // An empty value would be Sunday if it were read with `Number`.
    formData.append("schedule_weekdays", "");
    formData.append("schedule_weekdays", "3");
    formData.append("schedule_weekdays", "3");

    await createSeriesAction(null, formData);

    expect(mockCreateSeries).toHaveBeenCalledWith(
      expect.objectContaining({ scheduleWeekdays: [3] }),
      "en"
    );
  });

  it("refuses more tags than a series can carry", async () => {
    const { createSeriesAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("title", "Series title");
    formData.set("synopsis", "A synopsis");
    formData.set("reading_period_hours", "24");
    formData.set("label_public_id", "LABEL001");
    formData.set("status", "ongoing");
    formData.set("age_rating", "all");
    formData.set("comment_mode", "");
    formData.set("reading_direction", "rtl");
    formData.set("spread_start_page", "2");
    for (let index = 0; index <= 20; index += 1) {
      formData.append("tag_names", `tag-${index}`);
    }

    const result = await createSeriesAction(null, formData);

    expect(result).toEqual({
      message: "A series can carry at most 20 tags.",
      mode: "create",
      ok: false,
    });
    expect(mockCreateSeries).not.toHaveBeenCalled();
  });

  // A series that states a mode of its own posts it like any other field, and
  // the empty value above is the series stating none.
  it("sends the comment mode the series states", async () => {
    mockCreateSeries.mockResolvedValueOnce({
      ok: true,
      series: { publicId: "SERIES001" },
    });

    const { createSeriesAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("title", "Series title");
    formData.set("synopsis", "A synopsis");
    formData.set("reading_period_hours", "24");
    formData.set("label_public_id", "LABEL001");
    formData.set("status", "ongoing");
    formData.set("age_rating", "all");
    formData.set("comment_mode", "approval_required");
    formData.set("reading_direction", "rtl");
    formData.set("spread_start_page", "2");

    await createSeriesAction(null, formData);

    expect(mockCreateSeries).toHaveBeenCalledWith(
      expect.objectContaining({ commentMode: "approval_required" }),
      "en"
    );
  });

  it("refuses a comment mode the form could not have offered", async () => {
    const { createSeriesAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("title", "Series title");
    formData.set("synopsis", "A synopsis");
    formData.set("reading_period_hours", "24");
    formData.set("label_public_id", "LABEL001");
    formData.set("status", "ongoing");
    formData.set("age_rating", "all");
    formData.set("comment_mode", "moderated");
    formData.set("reading_direction", "rtl");
    formData.set("spread_start_page", "2");

    const result = await createSeriesAction(null, formData);

    expect(result).toEqual({
      message: "Select how comments on this series are published.",
      mode: "create",
      ok: false,
    });
    expect(mockCreateSeries).not.toHaveBeenCalled();
  });

  // The form counts pages from 1 and the API indexes them from 0.
  it("sends the layout the series states, with the page turned into an index", async () => {
    mockUpdateSeries.mockResolvedValueOnce({
      ok: true,
      series: { publicId: "SERIES001" },
    });

    const { updateSeriesAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("public_id", "SERIES001");
    formData.set("title", "Series title");
    formData.set("synopsis", "A synopsis");
    formData.set("reading_period_hours", "24");
    formData.set("label_public_id", "LABEL001");
    formData.set("status", "ongoing");
    formData.set("age_rating", "all");
    formData.set("comment_mode", "");
    formData.set("reading_direction", "ltr");
    formData.set("spread_start_page", "1");

    await updateSeriesAction(null, formData);

    expect(mockUpdateSeries).toHaveBeenCalledWith(
      expect.objectContaining({
        readingDirection: "ltr",
        spreadStartIndex: 0,
      }),
      "en"
    );
  });

  // `UpdateSeries` stores the default for a direction left out, so a save that
  // arrived without one would turn a left-to-right work back around.
  it("refuses a save that carries no reading direction", async () => {
    const { updateSeriesAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("public_id", "SERIES001");
    formData.set("title", "Series title");
    formData.set("synopsis", "A synopsis");
    formData.set("reading_period_hours", "24");
    formData.set("label_public_id", "LABEL001");
    formData.set("status", "ongoing");
    formData.set("age_rating", "all");
    formData.set("comment_mode", "");
    formData.set("spread_start_page", "2");

    const result = await updateSeriesAction(null, formData);

    expect(result).toEqual({
      message: "Select a reading direction.",
      mode: "update",
      ok: false,
    });
    expect(mockUpdateSeries).not.toHaveBeenCalled();
  });

  it.each(["", "0", "1.5", "-1", "two"])(
    "refuses %j as the page spreads start at",
    async (page) => {
      const { createSeriesAction } = await import("./actions");
      const formData = new FormData();
      formData.set("tenant_id", "TENANT001");
      formData.set("title", "Series title");
      formData.set("synopsis", "A synopsis");
      formData.set("reading_period_hours", "24");
      formData.set("label_public_id", "LABEL001");
      formData.set("status", "ongoing");
      formData.set("age_rating", "all");
      formData.set("comment_mode", "");
      formData.set("reading_direction", "rtl");
      formData.set("spread_start_page", page);

      const result = await createSeriesAction(null, formData);

      expect(result).toEqual({
        message:
          "Enter the page spreads start at as a whole number of 1 or more.",
        mode: "create",
        ok: false,
      });
      expect(mockCreateSeries).not.toHaveBeenCalled();
    }
  );

  it("sends the credit list the form posted, in the order it posted it", async () => {
    mockCreateSeries.mockResolvedValueOnce({
      ok: true,
      series: { publicId: "SERIES001" },
    });

    const { createSeriesAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("title", "Series title");
    formData.set("synopsis", "A synopsis");
    formData.set("reading_period_hours", "24");
    formData.set("label_public_id", "LABEL001");
    formData.set("status", "ongoing");
    formData.set("age_rating", "all");
    formData.set("comment_mode", "");
    formData.set("reading_direction", "rtl");
    formData.set("spread_start_page", "2");
    // One person credited twice under two roles, which is what the pair being
    // the identity of a credit allows.
    formData.set(
      "creator_credits",
      JSON.stringify([
        { creatorPublicId: "CREATOR001", rolePublicId: "ROLE001" },
        { creatorPublicId: "CREATOR001", rolePublicId: "ROLE002" },
        { creatorPublicId: "CREATOR002", rolePublicId: "ROLE002" },
      ])
    );

    await createSeriesAction(null, formData);

    expect(mockCreateSeries).toHaveBeenCalledWith(
      expect.objectContaining({
        creatorCredits: [
          { creatorPublicId: "CREATOR001", rolePublicId: "ROLE001" },
          { creatorPublicId: "CREATOR001", rolePublicId: "ROLE002" },
          { creatorPublicId: "CREATOR002", rolePublicId: "ROLE002" },
        ],
      }),
      "en"
    );
  });

  // A save replaces every credit the series holds, so a half-read list is
  // refused rather than compacted into the rows that happened to parse.
  it("refuses a credit that names no role", async () => {
    const { createSeriesAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("title", "Series title");
    formData.set("synopsis", "A synopsis");
    formData.set("reading_period_hours", "24");
    formData.set("label_public_id", "LABEL001");
    formData.set("status", "ongoing");
    formData.set("age_rating", "all");
    formData.set("comment_mode", "");
    formData.set("reading_direction", "rtl");
    formData.set("spread_start_page", "2");
    formData.set(
      "creator_credits",
      JSON.stringify([{ creatorPublicId: "CREATOR001", rolePublicId: "" }])
    );

    const result = await createSeriesAction(null, formData);

    expect(result).toEqual({
      message: "Every author credit needs an author and a role.",
      mode: "create",
      ok: false,
    });
    expect(mockCreateSeries).not.toHaveBeenCalled();
  });

  it("refuses a status the form could not have offered", async () => {
    const { createSeriesAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("title", "Series title");
    formData.set("synopsis", "A synopsis");
    formData.set("reading_period_hours", "24");
    formData.set("label_public_id", "LABEL001");
    formData.set("status", "cancelled");
    formData.set("age_rating", "all");
    formData.set("comment_mode", "");
    formData.set("reading_direction", "rtl");
    formData.set("spread_start_page", "2");

    const result = await createSeriesAction(null, formData);

    expect(result).toEqual({
      message: "Select a serialization status.",
      mode: "create",
      ok: false,
    });
    expect(mockCreateSeries).not.toHaveBeenCalled();
  });
});
