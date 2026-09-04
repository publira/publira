import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockGetAccessToken,
  mockGetTenantDisplayTimeZone,
  mockRedirect,
  mockReorderEpisodeImages,
  mockUpdateEpisodePublishSchedule,
  mockUploadEpisodePages,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetTenantDisplayTimeZone: vi.fn(),
  mockRedirect: vi.fn(),
  mockReorderEpisodeImages: vi.fn(),
  mockUpdateEpisodePublishSchedule: vi.fn(),
  mockUploadEpisodePages: vi.fn(),
}));

vi.mock("#lib/action-messages", async () => {
  const { sharedCatalog } = await import("@publira/i18n/catalog");
  return {
    getActionLocale: () => Promise.resolve("en"),
    getActionMessages: () => Promise.resolve(sharedCatalog("en")),
  };
});

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("#lib/episode", () => ({
  reorderEpisodeImages: mockReorderEpisodeImages,
  updateEpisodePublishSchedule: mockUpdateEpisodePublishSchedule,
  uploadEpisodePages: mockUploadEpisodePages,
}));

vi.mock("#lib/tenant-timezone", () => ({
  getTenantDisplayTimeZone: mockGetTenantDisplayTimeZone,
}));

describe("episode actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetTenantDisplayTimeZone.mockResolvedValue("Asia/Tokyo");
    // `withAdminSessionReauth` resolves the session before the mutation runs;
    // without a token every Action under test would redirect to /login.
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("updating the publish schedule returns an error when a hidden parameter is missing", async () => {
    const { updateEpisodeScheduleAction } = await import("./actions");
    const formData = new FormData();
    formData.set("series_public_id", "SERIES001");
    formData.set("episode_public_id", "EP001");
    formData.set("publish_at", "2026-06-01T10:00:00Z");

    const result = await updateEpisodeScheduleAction(null, formData);

    expect(result).toEqual({
      message: "Tenant ID is missing.",
      mode: "schedule",
      ok: false,
    });
    expect(mockUpdateEpisodePublishSchedule).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("updating the publish schedule returns an error when publish_at is malformed", async () => {
    const { updateEpisodeScheduleAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("series_public_id", "SERIES001");
    formData.set("episode_public_id", "EP001");
    formData.set("publish_at", "not-a-date");

    const result = await updateEpisodeScheduleAction(null, formData);

    expect(result).toEqual({
      message: "The publish_at format is invalid.",
      mode: "schedule",
      ok: false,
    });
    expect(mockUpdateEpisodePublishSchedule).not.toHaveBeenCalled();
  });

  it("updating the publish schedule calls the API and then redirects on success", async () => {
    mockUpdateEpisodePublishSchedule.mockResolvedValueOnce({ ok: true });

    const { updateEpisodeScheduleAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("series_public_id", "SERIES001");
    formData.set("episode_public_id", "EP001");
    formData.set("publish_at", "2099-06-01T10:00:00Z");

    await updateEpisodeScheduleAction(null, formData);

    expect(mockUpdateEpisodePublishSchedule).toHaveBeenCalledWith(
      {
        episodePublicId: "EP001",
        publishAt: "2099-06-01T10:00:00Z",
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockRedirect).toHaveBeenCalledWith(
      "/series/SERIES001/episodes/EP001?schedule_updated=1"
    );
  });

  it("updating the publish schedule reads the datetime-local wall clock in the tenant time zone", async () => {
    mockGetTenantDisplayTimeZone.mockResolvedValue("America/Los_Angeles");
    mockUpdateEpisodePublishSchedule.mockResolvedValueOnce({ ok: true });

    const { updateEpisodeScheduleAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("series_public_id", "SERIES001");
    formData.set("episode_public_id", "EP001");
    // Zone-less wall clock, as posted by <input type="datetime-local">.
    formData.set("publish_at", "2099-06-01T10:00");

    await updateEpisodeScheduleAction(null, formData);

    // PDT (UTC-7) in June — 10:00 in Los Angeles is 17:00Z.
    expect(mockUpdateEpisodePublishSchedule).toHaveBeenCalledWith(
      {
        episodePublicId: "EP001",
        publishAt: "2099-06-01T17:00:00Z",
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockGetTenantDisplayTimeZone).toHaveBeenCalledWith("TENANT001");
  });

  it("updating the publish schedule rejects a date-only publish_at as malformed", async () => {
    const { updateEpisodeScheduleAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("series_public_id", "SERIES001");
    formData.set("episode_public_id", "EP001");
    formData.set("publish_at", "2099-06-01");

    const result = await updateEpisodeScheduleAction(null, formData);

    expect(result).toEqual({
      message: "The publish_at format is invalid.",
      mode: "schedule",
      ok: false,
    });
    expect(mockUpdateEpisodePublishSchedule).not.toHaveBeenCalled();
  });

  it("submitting pages returns an error when no file is chosen in pages mode", async () => {
    const { uploadEpisodePagesAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("series_public_id", "SERIES001");
    formData.set("episode_public_id", "EP001");
    formData.set("upload_mode", "pages");

    const result = await uploadEpisodePagesAction(null, formData);

    expect(result).toEqual({
      message: "Select page images to add.",
      mode: "pages",
      ok: false,
    });
    expect(mockUploadEpisodePages).not.toHaveBeenCalled();
  });

  it("submitting pages returns an error when the extension is wrong in zip mode", async () => {
    const { uploadEpisodePagesAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("series_public_id", "SERIES001");
    formData.set("episode_public_id", "EP001");
    formData.set("upload_mode", "zip");
    formData.set(
      "archive",
      new File(["dummy"], "pages.txt", { type: "text/plain" })
    );

    const result = await uploadEpisodePagesAction(null, formData);

    expect(result).toEqual({
      message: "Select a ZIP (.zip) file.",
      mode: "pages",
      ok: false,
    });
    expect(mockUploadEpisodePages).not.toHaveBeenCalled();
  });

  it("submitting pages calls the API and then redirects on success in pages mode", async () => {
    mockUploadEpisodePages.mockResolvedValueOnce({ ok: true });

    const { uploadEpisodePagesAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("series_public_id", "SERIES001");
    formData.set("episode_public_id", "EP001");
    formData.set("upload_mode", "pages");
    formData.append("pages", new File(["a"], "1.png", { type: "image/png" }));
    formData.append("pages", new File(["b"], "2.png", { type: "image/png" }));

    await uploadEpisodePagesAction(null, formData);

    expect(mockUploadEpisodePages).toHaveBeenCalledWith(
      {
        episodePublicId: "EP001",
        pages: expect.arrayContaining([
          expect.objectContaining({ name: "1.png" }),
          expect.objectContaining({ name: "2.png" }),
        ]),
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockRedirect).toHaveBeenCalledWith(
      "/series/SERIES001/episodes/EP001?pages_uploaded=1"
    );
  });

  it("reordering images returns an error for invalid ordered_image_ids", async () => {
    const { reorderEpisodeImagesAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("series_public_id", "SERIES001");
    formData.set("episode_public_id", "EP001");
    formData.set("ordered_image_ids", "not-json");

    const result = await reorderEpisodeImagesAction(formData);

    expect(result).toEqual({
      message: "There are no images to reorder.",
      ok: false,
    });
    expect(mockReorderEpisodeImages).not.toHaveBeenCalled();
  });

  it("reordering images reflects the result of the reorder API on success", async () => {
    mockReorderEpisodeImages.mockResolvedValueOnce({ ok: true });

    const { reorderEpisodeImagesAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("series_public_id", "SERIES001");
    formData.set("episode_public_id", "EP001");
    formData.set("ordered_image_ids", JSON.stringify(["IMG1", "IMG2"]));

    const result = await reorderEpisodeImagesAction(formData);

    expect(mockReorderEpisodeImages).toHaveBeenCalledWith(
      {
        episodePublicId: "EP001",
        imageIds: ["IMG1", "IMG2"],
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(result).toEqual({ ok: true });
  });
});
