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
  const { sharedCatalog } = await import("@publira/i18n/catalog");
  return {
    getActionLocale: () => Promise.resolve("en"),
    getActionMessages: () => Promise.resolve(sharedCatalog("en")),
  };
});

vi.mock("next/cache", () => ({
  updateTag: mockUpdateTag,
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("#lib/series", () => ({
  createSeries: mockCreateSeries,
  seriesCacheTag: (tenantId: string, publicId: string) =>
    `series-${tenantId}-${publicId}`,
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
        creatorNames: [],
        creatorPublicIds: [],
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
    formData.set("published_at", "2030-01-01T10:00");
    formData.set("clear_eye_catch_image", "0");

    await updateSeriesAction(null, formData);

    expect(mockUpdateSeries).toHaveBeenCalledWith(
      {
        creatorPublicIds: [],
        eyeCatchImageContentType: undefined,
        eyeCatchImageData: undefined,
        isPublished: true,
        labelPublicId: "LABEL001",
        publicId: "SERIES001",
        // "2030-01-01T10:00" is a zone-less wall clock, read in the tenant zone
        // (Asia/Tokyo here) — never as the server process's local zone.
        publishedAt: "2030-01-01T01:00:00Z",
        readingPeriodHours: 24,
        synopsis: "A synopsis",
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
        creatorNames: [],
        creatorPublicIds: [],
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
        creatorNames: [],
        creatorPublicIds: [],
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
    formData.set("clear_eye_catch_image", "0");

    const result = await updateSeriesEyeCatchAction(null, formData);

    expect(result).toEqual({
      message: "Select an image or choose to remove it.",
      mode: "update",
      ok: false,
    });
    expect(mockUpdateSeries).not.toHaveBeenCalled();
  });
});
