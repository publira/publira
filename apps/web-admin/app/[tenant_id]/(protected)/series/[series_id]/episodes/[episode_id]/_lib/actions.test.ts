import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockCreateEpisodeFreeWindow,
  mockDeleteEpisodeFreeWindow,
  mockDeleteEpisodeImage,
  mockDeleteEpisodeTranslation,
  mockGetAccessToken,
  mockGetEpisode,
  mockGetTenantDisplayTimeZone,
  mockRedirect,
  mockRenewEpisodeImageUrls,
  mockReorderEpisodeImages,
  mockReplaceEpisodeCredits,
  mockUpdateEpisodeAvailability,
  mockUpdateEpisodeLayout,
  mockUpdateEpisodePricing,
  mockUpdateEpisodePublishSchedule,
  mockUpdateEpisodePurchaseAvailability,
  mockUpdateEpisodeTitle,
  mockUpdateTag,
  mockVerifyAdminSession,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockCreateEpisodeFreeWindow: vi.fn(),
  mockDeleteEpisodeFreeWindow: vi.fn(),
  mockDeleteEpisodeImage: vi.fn(),
  mockDeleteEpisodeTranslation: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetEpisode: vi.fn(),
  mockGetTenantDisplayTimeZone: vi.fn(),
  mockRedirect: vi.fn(),
  mockRenewEpisodeImageUrls: vi.fn(),
  mockReorderEpisodeImages: vi.fn(),
  mockReplaceEpisodeCredits: vi.fn(),
  mockUpdateEpisodeAvailability: vi.fn(),
  mockUpdateEpisodeLayout: vi.fn(),
  mockUpdateEpisodePricing: vi.fn(),
  mockUpdateEpisodePublishSchedule: vi.fn(),
  mockUpdateEpisodePurchaseAvailability: vi.fn(),
  mockUpdateEpisodeTitle: vi.fn(),
  mockUpdateTag: vi.fn(),
  mockVerifyAdminSession: vi.fn(),
}));

vi.mock("#lib/action-messages", async () => {
  const { bindMessages } = await import("@publira/i18n");
  const { sharedCatalog } = await import("@publira/i18n/catalog");
  return {
    getActionLocale: () => Promise.resolve("en"),
    getActionMessages: () =>
      Promise.resolve(bindMessages(sharedCatalog("en"), "en")),
  };
});

vi.mock("next/cache", () => ({
  updateTag: mockUpdateTag,
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/public-api", () => ({
  getTenantCurrency: () => Promise.resolve("JPY"),
}));

vi.mock("#lib/dashboard", () => ({
  tenantDashboardCacheTag: (tenantId: string) => `tenant:${tenantId}:dashboard`,
}));

vi.mock("#lib/auth-session", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  verifyAdminSession: mockVerifyAdminSession,
}));

vi.mock("#lib/session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("#lib/access-ticket", () => ({
  accessTicketsCacheTag: (tenantId: string) => `access-tickets-${tenantId}`,
}));

vi.mock("#lib/purchase", () => ({
  purchasesCacheTag: (tenantId: string) => `purchases-${tenantId}`,
}));

vi.mock("#lib/episode", () => ({
  deleteEpisodeImage: mockDeleteEpisodeImage,
  deleteEpisodeTranslation: mockDeleteEpisodeTranslation,
  episodeCacheTag: (tenantId: string, episodeId: string) =>
    `episode-${tenantId}-${episodeId}`,
  episodesCacheTag: (tenantId: string) => `episodes-${tenantId}`,
  getEpisodeForTenant: mockGetEpisode,
  renewEpisodeImageUrls: mockRenewEpisodeImageUrls,
  reorderEpisodeImages: mockReorderEpisodeImages,
  replaceEpisodeCredits: mockReplaceEpisodeCredits,
  updateEpisodeAvailability: mockUpdateEpisodeAvailability,
  updateEpisodeLayout: mockUpdateEpisodeLayout,
  updateEpisodePricing: mockUpdateEpisodePricing,
  updateEpisodePublishSchedule: mockUpdateEpisodePublishSchedule,
  updateEpisodePurchaseAvailability: mockUpdateEpisodePurchaseAvailability,
  updateEpisodeTitle: mockUpdateEpisodeTitle,
}));

vi.mock("#lib/episode-free-window", () => ({
  createEpisodeFreeWindow: mockCreateEpisodeFreeWindow,
  deleteEpisodeFreeWindow: mockDeleteEpisodeFreeWindow,
  episodeFreeWindowsCacheTag: (tenantId: string) =>
    `episode-free-windows-${tenantId}`,
}));

vi.mock("#lib/tenant-timezone", () => ({
  getTenantDisplayTimeZone: mockGetTenantDisplayTimeZone,
}));

const layoutFormData = (fields: Record<string, string>) => {
  const formData = new FormData();
  formData.set("tenant_id", "TENANT001");
  formData.set("series_public_id", "SERIES001");
  formData.set("episode_public_id", "EP001");
  formData.set("episode_id", "018f0e6a-4000-7000-8000-000000000001");
  for (const [name, value] of Object.entries(fields)) {
    formData.set(name, value);
  }
  return formData;
};

const startsAt = () => Temporal.Now.instant().add({ hours: 1 }).toString();
const endsAt = () => Temporal.Now.instant().add({ hours: 25 }).toString();

const deleteFormData = (freeWindowId: string) => {
  const formData = new FormData();
  formData.set("tenant_id", "TENANT001");
  formData.set("free_window_id", freeWindowId);
  return formData;
};

const deleteImageFormData = (imageId: string) => {
  const formData = new FormData();
  formData.set("tenant_id", "TENANT001");
  formData.set("episode_id", "018f0e6a-4000-7000-8000-000000000001");
  formData.set("image_id", imageId);
  return formData;
};

describe("episode actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetTenantDisplayTimeZone.mockResolvedValue("UTC");
    // `withAdminSessionReauth` resolves the session before the mutation runs;
    // without a token every Action under test would redirect to /login.
    mockGetAccessToken.mockResolvedValue("session-token");
    // The episode the form's URL names is the one its internal ID addresses.
    mockGetEpisode.mockResolvedValue({
      episode: {
        id: "018f0e6a-4000-7000-8000-000000000001",
        publicId: "EP001",
      },
      ok: true,
    });
  });

  it("refuses a save whose URL names a different episode than its ID", async () => {
    mockGetEpisode.mockResolvedValueOnce({
      episode: {
        id: "018f0e6a-4000-7000-8000-000000000002",
        publicId: "EP001",
      },
      ok: true,
    });

    const { updateEpisodeLayoutAction } = await import("./actions");
    const result = await updateEpisodeLayoutAction(
      { message: "", ok: false },
      layoutFormData({ reading_direction: "", spread_start_source: "series" })
    );

    expect(result).toEqual({
      message: "Episode ID is missing.",
      ok: false,
    });
    expect(mockUpdateEpisodeLayout).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(mockVerifyAdminSession).toHaveBeenCalledWith("TENANT001");
  });

  it("updating the layout sends the page the episode states as an index", async () => {
    mockUpdateEpisodeLayout.mockResolvedValueOnce({ ok: true });

    const { updateEpisodeLayoutAction } = await import("./actions");
    await updateEpisodeLayoutAction(
      null,
      layoutFormData({
        reading_direction: "ltr",
        spread_start_page: "1",
        spread_start_source: "episode",
      })
    );

    expect(mockUpdateEpisodeLayout).toHaveBeenCalledWith(
      {
        episodeId: "018f0e6a-4000-7000-8000-000000000001",
        readingDirection: "ltr",
        spreadStartIndex: 0,
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "episode-TENANT001-018f0e6a-4000-7000-8000-000000000001"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("episodes-TENANT001");
    expect(mockRedirect).toHaveBeenCalledWith(
      "/series/SERIES001/episodes/EP001?layout_updated=1"
    );
  });

  // A page left in the field from before the operator switched back to the
  // series must not become an override.
  it("updating the layout sends no override for values that follow the series", async () => {
    mockUpdateEpisodeLayout.mockResolvedValueOnce({ ok: true });

    const { updateEpisodeLayoutAction } = await import("./actions");
    await updateEpisodeLayoutAction(
      null,
      layoutFormData({
        reading_direction: "",
        spread_start_page: "3",
        spread_start_source: "series",
      })
    );

    expect(mockUpdateEpisodeLayout).toHaveBeenCalledWith(
      {
        episodeId: "018f0e6a-4000-7000-8000-000000000001",
        readingDirection: "",
        spreadStartIndex: undefined,
        tenantId: "TENANT001",
      },
      "en"
    );
  });

  it("updating the layout refuses a direction the form could not have offered", async () => {
    const { updateEpisodeLayoutAction } = await import("./actions");
    const result = await updateEpisodeLayoutAction(
      null,
      layoutFormData({
        reading_direction: "ttb",
        spread_start_source: "series",
      })
    );

    expect(result).toEqual({
      message: "Select a reading direction, or follow the series.",
      ok: false,
    });
    expect(mockUpdateEpisodeLayout).not.toHaveBeenCalled();
  });

  it.each(["", "0", "2.5"])(
    "updating the layout refuses %j as the page spreads start at",
    async (page) => {
      const { updateEpisodeLayoutAction } = await import("./actions");
      const result = await updateEpisodeLayoutAction(
        null,
        layoutFormData({
          reading_direction: "",
          spread_start_page: page,
          spread_start_source: "episode",
        })
      );

      expect(result).toEqual({
        message:
          "Enter the page spreads start at as a whole number of 1 or more.",
        ok: false,
      });
      expect(mockUpdateEpisodeLayout).not.toHaveBeenCalled();
    }
  );

  it("updating the layout shows the refusal the server gave", async () => {
    mockUpdateEpisodeLayout.mockResolvedValueOnce({
      message:
        "Spreads cannot start past the episode's last page. Choose one of its pages.",
      ok: false,
    });

    const { updateEpisodeLayoutAction } = await import("./actions");
    const result = await updateEpisodeLayoutAction(
      null,
      layoutFormData({
        reading_direction: "",
        spread_start_page: "40",
        spread_start_source: "episode",
      })
    );

    expect(result).toEqual({
      message:
        "Spreads cannot start past the episode's last page. Choose one of its pages.",
      ok: false,
    });
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("updating the availability sends the surfaces the episode states", async () => {
    mockUpdateEpisodeAvailability.mockResolvedValueOnce({
      availability: "app",
      ok: true,
    });

    const { updateEpisodeAvailabilityAction } = await import("./actions");
    await updateEpisodeAvailabilityAction(
      null,
      layoutFormData({ availability: "app" })
    );

    expect(mockUpdateEpisodeAvailability).toHaveBeenCalledWith(
      {
        availability: "app",
        episodeId: "018f0e6a-4000-7000-8000-000000000001",
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "episode-TENANT001-018f0e6a-4000-7000-8000-000000000001"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("episodes-TENANT001");
    expect(mockRedirect).toHaveBeenCalledWith(
      "/series/SERIES001/episodes/EP001?availability_updated=1"
    );
  });

  // The empty value is what returns an overridden episode to its series, so a
  // later change to the series reaches it again.
  it("updating the availability sends the empty value to follow the series", async () => {
    mockUpdateEpisodeAvailability.mockResolvedValueOnce({
      availability: "",
      ok: true,
    });

    const { updateEpisodeAvailabilityAction } = await import("./actions");
    await updateEpisodeAvailabilityAction(
      null,
      layoutFormData({ availability: "" })
    );

    expect(mockUpdateEpisodeAvailability).toHaveBeenCalledWith(
      expect.objectContaining({ availability: "" }),
      "en"
    );
  });

  it("updating the availability refuses surfaces the form could not have offered", async () => {
    const { updateEpisodeAvailabilityAction } = await import("./actions");
    const result = await updateEpisodeAvailabilityAction(
      null,
      layoutFormData({ availability: "everywhere" })
    );

    expect(result).toEqual({
      message: "Choose where the episode is shown, or follow the series.",
      ok: false,
    });
    expect(mockUpdateEpisodeAvailability).not.toHaveBeenCalled();
  });

  it("updating the availability shows the failure the API reported", async () => {
    mockUpdateEpisodeAvailability.mockResolvedValueOnce({
      message:
        "Could not update where the episode is shown. Please try again later.",
      ok: false,
    });

    const { updateEpisodeAvailabilityAction } = await import("./actions");
    const result = await updateEpisodeAvailabilityAction(
      null,
      layoutFormData({ availability: "web" })
    );

    expect(result).toEqual({
      message:
        "Could not update where the episode is shown. Please try again later.",
      ok: false,
    });
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("updating where it is sold sends the value the episode states", async () => {
    mockUpdateEpisodePurchaseAvailability.mockResolvedValueOnce({
      ok: true,
      purchaseAvailability: "app",
    });

    const { updateEpisodePurchaseAvailabilityAction } =
      await import("./actions");
    await updateEpisodePurchaseAvailabilityAction(
      null,
      layoutFormData({ purchase_availability: "app" })
    );

    expect(mockUpdateEpisodePurchaseAvailability).toHaveBeenCalledWith(
      {
        episodeId: "018f0e6a-4000-7000-8000-000000000001",
        purchaseAvailability: "app",
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "episode-TENANT001-018f0e6a-4000-7000-8000-000000000001"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("episodes-TENANT001");
    expect(mockRedirect).toHaveBeenCalledWith(
      "/series/SERIES001/episodes/EP001?purchase_availability_updated=1"
    );
  });

  // The empty value is what returns an overridden episode to its series, so a
  // later change to the series or the tenant default reaches it again.
  it("updating where it is sold sends the empty value to follow the series", async () => {
    mockUpdateEpisodePurchaseAvailability.mockResolvedValueOnce({
      ok: true,
      purchaseAvailability: "",
    });

    const { updateEpisodePurchaseAvailabilityAction } =
      await import("./actions");
    await updateEpisodePurchaseAvailabilityAction(
      null,
      layoutFormData({ purchase_availability: "" })
    );

    expect(mockUpdateEpisodePurchaseAvailability).toHaveBeenCalledWith(
      expect.objectContaining({ purchaseAvailability: "" }),
      "en"
    );
  });

  it("updating where it is sold refuses a value the form could not have offered", async () => {
    const { updateEpisodePurchaseAvailabilityAction } =
      await import("./actions");
    const result = await updateEpisodePurchaseAvailabilityAction(
      null,
      layoutFormData({ purchase_availability: "everywhere" })
    );

    expect(result).toEqual({
      message: "Choose where the episode is sold, or follow the series.",
      ok: false,
    });
    expect(mockUpdateEpisodePurchaseAvailability).not.toHaveBeenCalled();
  });

  it("updating where it is sold shows the failure the API reported", async () => {
    mockUpdateEpisodePurchaseAvailability.mockResolvedValueOnce({
      message:
        "Could not update where the episode is sold. Please try again later.",
      ok: false,
    });

    const { updateEpisodePurchaseAvailabilityAction } =
      await import("./actions");
    const result = await updateEpisodePurchaseAvailabilityAction(
      null,
      layoutFormData({ purchase_availability: "web" })
    );

    expect(result).toEqual({
      message:
        "Could not update where the episode is sold. Please try again later.",
      ok: false,
    });
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("updating the publish schedule returns an error when a hidden parameter is missing", async () => {
    const { updateEpisodeScheduleAction } = await import("./actions");
    const formData = new FormData();
    formData.set("series_public_id", "SERIES001");
    formData.set("episode_public_id", "EP001");
    formData.set("episode_id", "018f0e6a-4000-7000-8000-000000000001");
    formData.set("publish_at", "2026-06-01T10:00:00Z");

    const result = await updateEpisodeScheduleAction(null, formData);

    expect(result).toEqual({
      message: "Tenant ID is missing.",
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
    formData.set("episode_id", "018f0e6a-4000-7000-8000-000000000001");
    formData.set("publish_at", "not-a-date");

    const result = await updateEpisodeScheduleAction(null, formData);

    expect(result).toEqual({
      message: "The publication date and time is invalid.",
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
    formData.set("episode_id", "018f0e6a-4000-7000-8000-000000000001");
    formData.set("publish_at", "2099-06-01T10:00:00Z");

    await updateEpisodeScheduleAction(null, formData);

    expect(mockUpdateEpisodePublishSchedule).toHaveBeenCalledWith(
      {
        episodeId: "018f0e6a-4000-7000-8000-000000000001",
        publishAt: "2099-06-01T10:00:00Z",
        tenantId: "TENANT001",
      },
      "en"
    );
    // The dashboard counts drafts and scheduled episodes and lists them in its
    // publishing queue, so a new schedule changes what it shows.
    expect(mockUpdateTag).toHaveBeenCalledWith("tenant:TENANT001:dashboard");
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "episode-TENANT001-018f0e6a-4000-7000-8000-000000000001"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("episodes-TENANT001");
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
    formData.set("episode_id", "018f0e6a-4000-7000-8000-000000000001");
    // Zone-less wall clock, as posted by <input type="datetime-local">.
    formData.set("publish_at", "2099-06-01T10:00");

    await updateEpisodeScheduleAction(null, formData);

    // PDT (UTC-7) in June — 10:00 in Los Angeles is 17:00Z.
    expect(mockUpdateEpisodePublishSchedule).toHaveBeenCalledWith(
      {
        episodeId: "018f0e6a-4000-7000-8000-000000000001",
        publishAt: "2099-06-01T17:00:00Z",
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockGetTenantDisplayTimeZone).toHaveBeenCalledWith("TENANT001");
  });

  // The API publishes a draft at once with a time that has passed, and leaves
  // a published episode as it is, so the time a published episode was opened
  // with saves rather than failing.
  it("updating the publish schedule sends a time that has passed to the API", async () => {
    mockUpdateEpisodePublishSchedule.mockResolvedValueOnce({ ok: true });

    const { updateEpisodeScheduleAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("series_public_id", "SERIES001");
    formData.set("episode_public_id", "EP001");
    formData.set("episode_id", "018f0e6a-4000-7000-8000-000000000001");
    formData.set("publish_at", "2020-06-01T10:00:00Z");

    await updateEpisodeScheduleAction(null, formData);

    expect(mockUpdateEpisodePublishSchedule).toHaveBeenCalledWith(
      {
        episodeId: "018f0e6a-4000-7000-8000-000000000001",
        publishAt: "2020-06-01T10:00:00Z",
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockRedirect).toHaveBeenCalledWith(
      "/series/SERIES001/episodes/EP001?schedule_updated=1"
    );
  });

  it("updating the publish schedule rejects a date-only publish_at as malformed", async () => {
    const { updateEpisodeScheduleAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("series_public_id", "SERIES001");
    formData.set("episode_public_id", "EP001");
    formData.set("episode_id", "018f0e6a-4000-7000-8000-000000000001");
    formData.set("publish_at", "2099-06-01");

    const result = await updateEpisodeScheduleAction(null, formData);

    expect(result).toEqual({
      message: "The publication date and time is invalid.",
      ok: false,
    });
    expect(mockUpdateEpisodePublishSchedule).not.toHaveBeenCalled();
  });

  it("reordering images returns an error for invalid ordered_image_ids", async () => {
    const { reorderEpisodeImagesAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("series_public_id", "SERIES001");
    formData.set("episode_public_id", "EP001");
    formData.set("episode_id", "018f0e6a-4000-7000-8000-000000000001");
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
    formData.set("episode_id", "018f0e6a-4000-7000-8000-000000000001");
    formData.set("ordered_image_ids", JSON.stringify(["IMG1", "IMG2"]));

    const result = await reorderEpisodeImagesAction(formData);

    expect(mockReorderEpisodeImages).toHaveBeenCalledWith(
      {
        episodeId: "018f0e6a-4000-7000-8000-000000000001",
        imageIds: ["IMG1", "IMG2"],
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "episode-TENANT001-018f0e6a-4000-7000-8000-000000000001"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("episodes-TENANT001");
    expect(result).toEqual({ ok: true });
  });

  it("replacing the credits clears the episode's tags before it redirects", async () => {
    mockReplaceEpisodeCredits.mockResolvedValueOnce({ ok: true });

    const { replaceEpisodeCreditsAction } = await import("./actions");
    await replaceEpisodeCreditsAction(
      { message: "", ok: false },
      layoutFormData({ creator_credits: "[]" })
    );

    expect(mockReplaceEpisodeCredits).toHaveBeenCalledWith(
      {
        creatorCredits: [],
        episodeId: "018f0e6a-4000-7000-8000-000000000001",
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("episodes-TENANT001");
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "episode-TENANT001-018f0e6a-4000-7000-8000-000000000001"
    );
    expect(mockRedirect).toHaveBeenCalledWith(
      "/series/SERIES001/episodes/EP001?credits_updated=1"
    );
  });

  describe("adding a free reading period", () => {
    it("schedules the period on the episode and clears the windows' tag before it redirects", async () => {
      mockCreateEpisodeFreeWindow.mockResolvedValueOnce({
        freeWindow: { id: "WINDOW1" },
        ok: true,
      });
      const start = startsAt();
      const end = endsAt();

      const { createEpisodeFreeWindowAction } = await import("./actions");
      await createEpisodeFreeWindowAction(
        null,
        layoutFormData({ ends_at: end, starts_at: start })
      );

      expect(mockCreateEpisodeFreeWindow).toHaveBeenCalledWith(
        {
          endsAt: end,
          episodeId: "018f0e6a-4000-7000-8000-000000000001",
          startsAt: start,
          tenantId: "TENANT001",
        },
        "en"
      );
      expect(mockUpdateTag).toHaveBeenCalledWith(
        "episode-free-windows-TENANT001"
      );
      expect(mockRedirect).toHaveBeenCalledWith(
        "/series/SERIES001/episodes/EP001?free_window_created=1"
      );
    });

    it("refuses a period that ends before it starts without calling the API", async () => {
      const { createEpisodeFreeWindowAction } = await import("./actions");
      const result = await createEpisodeFreeWindowAction(
        null,
        layoutFormData({ ends_at: startsAt(), starts_at: endsAt() })
      );

      expect(result).toEqual({
        message:
          "Enter an end that is after the start and still in the future.",
        ok: false,
      });
      expect(mockCreateEpisodeFreeWindow).not.toHaveBeenCalled();
    });

    it("shows the failure the API reported and stays on the form", async () => {
      mockCreateEpisodeFreeWindow.mockResolvedValueOnce({
        message: "overlaps",
        ok: false,
      });

      const { createEpisodeFreeWindowAction } = await import("./actions");
      const result = await createEpisodeFreeWindowAction(
        null,
        layoutFormData({ ends_at: endsAt(), starts_at: startsAt() })
      );

      expect(result).toEqual({ message: "overlaps", ok: false });
      expect(mockUpdateTag).not.toHaveBeenCalled();
      expect(mockRedirect).not.toHaveBeenCalled();
    });
  });

  describe("renaming the episode", () => {
    it("sends the trimmed title and clears every read that shows it", async () => {
      mockUpdateEpisodeTitle.mockResolvedValueOnce({
        episode: { title: "Episode 1 — Morning" },
        ok: true,
      });

      const { updateEpisodeTitleAction } = await import("./actions");
      await updateEpisodeTitleAction(
        null,
        layoutFormData({ title: "  Episode 1 — Morning  " })
      );

      expect(mockUpdateEpisodeTitle).toHaveBeenCalledWith(
        {
          episodeId: "018f0e6a-4000-7000-8000-000000000001",
          tenantId: "TENANT001",
          title: "Episode 1 — Morning",
        },
        "en"
      );
      expect(mockUpdateTag).toHaveBeenCalledWith("episodes-TENANT001");
      expect(mockUpdateTag).toHaveBeenCalledWith(
        "episode-TENANT001-018f0e6a-4000-7000-8000-000000000001"
      );
      // The access ticket and purchase lists name the episode each row opens.
      expect(mockUpdateTag).toHaveBeenCalledWith("access-tickets-TENANT001");
      expect(mockUpdateTag).toHaveBeenCalledWith("purchases-TENANT001");
      expect(mockRedirect).toHaveBeenCalledWith(
        "/series/SERIES001/episodes/EP001?title_updated=1"
      );
    });

    it("refuses a title of nothing but white space", async () => {
      const { updateEpisodeTitleAction } = await import("./actions");
      const result = await updateEpisodeTitleAction(
        null,
        layoutFormData({ title: "   " })
      );

      expect(result).toEqual({ message: "Title is required.", ok: false });
      expect(mockUpdateEpisodeTitle).not.toHaveBeenCalled();
    });

    it("shows the failure the API reported and stays on the form", async () => {
      mockUpdateEpisodeTitle.mockResolvedValueOnce({
        message: "Could not update the title. Please try again later.",
        ok: false,
      });

      const { updateEpisodeTitleAction } = await import("./actions");
      const result = await updateEpisodeTitleAction(
        null,
        layoutFormData({ title: "Episode 1" })
      );

      expect(result).toEqual({
        message: "Could not update the title. Please try again later.",
        ok: false,
      });
      expect(mockUpdateTag).not.toHaveBeenCalled();
      expect(mockRedirect).not.toHaveBeenCalled();
    });

    it("saves the title in the language of the tab the form is on, and returns to that tab", async () => {
      mockUpdateEpisodeTitle.mockResolvedValueOnce({
        episode: { title: "Episode 1 — Morning" },
        ok: true,
      });

      const { updateEpisodeTitleAction } = await import("./actions");
      await updateEpisodeTitleAction(
        null,
        layoutFormData({
          title: "Episode 1 — Morning",
          translation_locale: "en",
        })
      );

      expect(mockUpdateEpisodeTitle).toHaveBeenCalledWith(
        {
          episodeId: "018f0e6a-4000-7000-8000-000000000001",
          tenantId: "TENANT001",
          title: "Episode 1 — Morning",
          translationLocale: "en",
        },
        "en"
      );
      expect(mockRedirect).toHaveBeenCalledWith(
        "/series/SERIES001/episodes/EP001?locale=en&title_updated=1"
      );
    });

    it("refuses a language this build serves no catalog for", async () => {
      const { updateEpisodeTitleAction } = await import("./actions");
      const result = await updateEpisodeTitleAction(
        null,
        layoutFormData({ title: "Episode 1", translation_locale: "xx" })
      );

      expect(result).toEqual({
        message: "Choose a supported language.",
        ok: false,
      });
      expect(mockUpdateEpisodeTitle).not.toHaveBeenCalled();
    });
  });

  describe("deleting one language's title", () => {
    it("deletes the translation, clears every read that shows the title, and opens the episode on another", async () => {
      mockDeleteEpisodeTranslation.mockResolvedValueOnce({ ok: true });

      const { deleteEpisodeTranslationAction } = await import("./actions");
      await deleteEpisodeTranslationAction(
        null,
        layoutFormData({ translation_locale: "en" })
      );

      expect(mockDeleteEpisodeTranslation).toHaveBeenCalledWith(
        {
          episodeId: "018f0e6a-4000-7000-8000-000000000001",
          tenantId: "TENANT001",
          translationLocale: "en",
        },
        "en"
      );
      expect(mockUpdateTag).toHaveBeenCalledWith("episodes-TENANT001");
      expect(mockUpdateTag).toHaveBeenCalledWith(
        "episode-TENANT001-018f0e6a-4000-7000-8000-000000000001"
      );
      expect(mockUpdateTag).toHaveBeenCalledWith("access-tickets-TENANT001");
      expect(mockUpdateTag).toHaveBeenCalledWith("purchases-TENANT001");
      expect(mockRedirect).toHaveBeenCalledWith(
        "/series/SERIES001/episodes/EP001?translation_deleted=1"
      );
    });

    it("shows the refusal the API gave and stays on the screen", async () => {
      mockDeleteEpisodeTranslation.mockResolvedValueOnce({
        message:
          "An episode keeps at least one translation, so its last one cannot be deleted.",
        ok: false,
      });

      const { deleteEpisodeTranslationAction } = await import("./actions");
      const result = await deleteEpisodeTranslationAction(
        null,
        layoutFormData({ translation_locale: "ja" })
      );

      expect(result).toEqual({
        message:
          "An episode keeps at least one translation, so its last one cannot be deleted.",
        ok: false,
      });
      expect(mockUpdateTag).not.toHaveBeenCalled();
      expect(mockRedirect).not.toHaveBeenCalled();
    });

    it("refuses a delete that names no language", async () => {
      const { deleteEpisodeTranslationAction } = await import("./actions");
      const result = await deleteEpisodeTranslationAction(
        null,
        layoutFormData({})
      );

      expect(result).toEqual({
        message: "Choose a supported language.",
        ok: false,
      });
      expect(mockDeleteEpisodeTranslation).not.toHaveBeenCalled();
    });
  });

  describe("changing the price and reading period", () => {
    it("sends both values and clears the reads that show them", async () => {
      mockUpdateEpisodePricing.mockResolvedValueOnce({
        episode: { price: 120, readingPeriodHours: 72 },
        ok: true,
      });

      const { updateEpisodePricingAction } = await import("./actions");
      await updateEpisodePricingAction(
        null,
        layoutFormData({
          price: "120",
          price_currency: "JPY",
          reading_period_hours: "72",
        })
      );

      expect(mockUpdateEpisodePricing).toHaveBeenCalledWith(
        {
          currency: "JPY",
          episodeId: "018f0e6a-4000-7000-8000-000000000001",
          price: 120,
          readingPeriodHours: 72,
          rentalPeriodHours: 0,
          rentalPrice: 0,
          tenantId: "TENANT001",
        },
        "en"
      );
      expect(mockUpdateTag).toHaveBeenCalledWith("episodes-TENANT001");
      expect(mockUpdateTag).toHaveBeenCalledWith(
        "episode-TENANT001-018f0e6a-4000-7000-8000-000000000001"
      );
      expect(mockRedirect).toHaveBeenCalledWith(
        "/series/SERIES001/episodes/EP001?pricing_updated=1"
      );
    });

    it("sends the rental beside the permanent copy", async () => {
      mockUpdateEpisodePricing.mockResolvedValueOnce({
        episode: { price: 120, readingPeriodHours: 0 },
        ok: true,
      });

      const { updateEpisodePricingAction } = await import("./actions");
      await updateEpisodePricingAction(
        null,
        layoutFormData({
          price: "120",
          price_currency: "JPY",
          reading_period_hours: "0",
          rental_period_hours: "48",
          rental_price: "80",
        })
      );

      expect(mockUpdateEpisodePricing).toHaveBeenCalledWith(
        expect.objectContaining({ rentalPeriodHours: 48, rentalPrice: 80 }),
        "en"
      );
    });

    // The period starts at the series' whether or not the episode is rented,
    // so a blank rental price is what stops renting it.
    it("stops renting the episode when the rental price is blank", async () => {
      mockUpdateEpisodePricing.mockResolvedValueOnce({
        episode: { price: 120, readingPeriodHours: 0 },
        ok: true,
      });

      const { updateEpisodePricingAction } = await import("./actions");
      await updateEpisodePricingAction(
        null,
        layoutFormData({
          price: "120",
          price_currency: "JPY",
          reading_period_hours: "0",
          rental_period_hours: "48",
          rental_price: "",
        })
      );

      expect(mockUpdateEpisodePricing).toHaveBeenCalledWith(
        expect.objectContaining({ rentalPeriodHours: 0, rentalPrice: 0 }),
        "en"
      );
    });

    // The API's rules for a rental, checked before anything is sent.
    it.each([
      [
        "a rental that costs as much as the permanent copy",
        "120",
        "120",
        "48",
        "Rental price must be lower than the price. A free episode cannot be rented.",
      ],
      [
        "a rental of a free episode",
        "0",
        "80",
        "48",
        "Rental price must be lower than the price. A free episode cannot be rented.",
      ],
      [
        "a free rental",
        "120",
        "0",
        "48",
        "Rental price must be more than 0, with no more decimal places than the currency has.",
      ],
      [
        "a rental price in a fraction of a yen",
        "120",
        "80.5",
        "48",
        "Rental price must be more than 0, with no more decimal places than the currency has.",
      ],
      [
        "a rental with no period",
        "120",
        "80",
        "",
        "Rental period must be a whole number of hours, 1 or more, when a rental price is set.",
      ],
      [
        "a rental for no time",
        "120",
        "80",
        "0",
        "Rental period must be a whole number of hours, 1 or more, when a rental price is set.",
      ],
      [
        "a rental for a fraction of an hour",
        "120",
        "80",
        "1.9",
        "Rental period must be a whole number of hours, 1 or more, when a rental price is set.",
      ],
    ])(
      "refuses %s",
      async (_case, price, rentalPrice, rentalPeriodHours, message) => {
        const { updateEpisodePricingAction } = await import("./actions");
        const result = await updateEpisodePricingAction(
          null,
          layoutFormData({
            price,
            price_currency: "JPY",
            reading_period_hours: "0",
            rental_period_hours: rentalPeriodHours,
            rental_price: rentalPrice,
          })
        );

        expect(result).toEqual({ message, ok: false });
        expect(mockUpdateEpisodePricing).not.toHaveBeenCalled();
      }
    );

    // The new-episode form's rules, which stop at what an int32 field carries
    // and at the decimal places of the tenant's currency.
    it.each([
      [
        "a negative price",
        "-1",
        "72",
        "Price must be 0 or more, with no more decimal places than the currency has.",
      ],
      [
        "a price past an int32",
        "2147483648",
        "72",
        "Price must be 0 or more, with no more decimal places than the currency has.",
      ],
      [
        "a fraction of a yen",
        "100.5",
        "72",
        "Price must be 0 or more, with no more decimal places than the currency has.",
      ],
      [
        "a reading period that is not a whole number",
        "100",
        "a day",
        "Reading period must be a non-negative integer.",
      ],
    ])("refuses %s", async (_case, price, readingPeriodHours, message) => {
      const { updateEpisodePricingAction } = await import("./actions");
      const result = await updateEpisodePricingAction(
        null,
        layoutFormData({
          price,
          price_currency: "JPY",
          reading_period_hours: readingPeriodHours,
        })
      );

      expect(result).toEqual({ message, ok: false });
      expect(mockUpdateEpisodePricing).not.toHaveBeenCalled();
    });

    // The form was opened while the tenant sold in another currency, so the
    // number in it is an amount of that currency.
    it("refuses a price typed in the currency the tenant sold in before", async () => {
      const { updateEpisodePricingAction } = await import("./actions");
      const result = await updateEpisodePricingAction(
        null,
        layoutFormData({
          price: "5.00",
          price_currency: "USD",
          reading_period_hours: "72",
        })
      );

      expect(result).toEqual({
        message:
          "The tenant's currency changed after this form was opened. Reload the page and enter the price again.",
        ok: false,
      });
      expect(mockUpdateEpisodePricing).not.toHaveBeenCalled();
    });

    it("shows the failure the API reported and stays on the form", async () => {
      mockUpdateEpisodePricing.mockResolvedValueOnce({
        message:
          "Could not update the price and reading period. Please try again later.",
        ok: false,
      });

      const { updateEpisodePricingAction } = await import("./actions");
      const result = await updateEpisodePricingAction(
        null,
        layoutFormData({
          price: "100",
          price_currency: "JPY",
          reading_period_hours: "0",
        })
      );

      expect(result).toEqual({
        message:
          "Could not update the price and reading period. Please try again later.",
        ok: false,
      });
      expect(mockUpdateTag).not.toHaveBeenCalled();
      expect(mockRedirect).not.toHaveBeenCalled();
    });
  });

  describe("deleting a page", () => {
    it("deletes the page and clears the episode's tags", async () => {
      mockDeleteEpisodeImage.mockResolvedValueOnce({ images: [], ok: true });

      const { deleteEpisodeImageAction } = await import("./actions");
      const result = await deleteEpisodeImageAction(
        null,
        deleteImageFormData("018f0e6a-5000-7000-8000-000000000001")
      );

      expect(mockDeleteEpisodeImage).toHaveBeenCalledWith(
        {
          episodeId: "018f0e6a-4000-7000-8000-000000000001",
          imageId: "018f0e6a-5000-7000-8000-000000000001",
          tenantId: "TENANT001",
        },
        "en"
      );
      expect(mockUpdateTag).toHaveBeenCalledWith("episodes-TENANT001");
      expect(mockUpdateTag).toHaveBeenCalledWith(
        "episode-TENANT001-018f0e6a-4000-7000-8000-000000000001"
      );
      expect(result).toEqual({ message: "Page deleted.", ok: true });
    });

    it("leaves the tags alone when the delete failed", async () => {
      mockDeleteEpisodeImage.mockResolvedValueOnce({
        message:
          "The page could not be found. Reload the screen and try again.",
        ok: false,
      });

      const { deleteEpisodeImageAction } = await import("./actions");
      const result = await deleteEpisodeImageAction(
        null,
        deleteImageFormData("018f0e6a-5000-7000-8000-000000000001")
      );

      expect(mockUpdateTag).not.toHaveBeenCalled();
      expect(result).toEqual({
        message:
          "The page could not be found. Reload the screen and try again.",
        ok: false,
      });
    });

    it("refuses a page id that is not one", async () => {
      const { deleteEpisodeImageAction } = await import("./actions");
      const result = await deleteEpisodeImageAction(
        null,
        deleteImageFormData("not-an-id")
      );

      expect(result).toEqual({ message: "Page ID is missing.", ok: false });
      expect(mockDeleteEpisodeImage).not.toHaveBeenCalled();
    });
  });

  describe("deleting a free reading period", () => {
    it("deletes the window and clears the windows' tag", async () => {
      mockDeleteEpisodeFreeWindow.mockResolvedValueOnce({
        alreadyDeleted: false,
        ok: true,
      });

      const { deleteEpisodeFreeWindowAction } = await import("./actions");
      const result = await deleteEpisodeFreeWindowAction(
        null,
        deleteFormData("018f0e6a-4000-7000-8000-0000000000f1")
      );

      expect(mockDeleteEpisodeFreeWindow).toHaveBeenCalledWith(
        {
          freeWindowId: "018f0e6a-4000-7000-8000-0000000000f1",
          tenantId: "TENANT001",
        },
        "en"
      );
      expect(mockUpdateTag).toHaveBeenCalledWith(
        "episode-free-windows-TENANT001"
      );
      expect(result).toEqual({
        message: "Free reading period deleted.",
        ok: true,
      });
    });

    it("still clears the windows' tag when the window was already gone", async () => {
      mockDeleteEpisodeFreeWindow.mockResolvedValueOnce({
        alreadyDeleted: true,
        ok: true,
      });

      const { deleteEpisodeFreeWindowAction } = await import("./actions");
      const result = await deleteEpisodeFreeWindowAction(
        null,
        deleteFormData("018f0e6a-4000-7000-8000-0000000000f1")
      );

      expect(mockUpdateTag).toHaveBeenCalledWith(
        "episode-free-windows-TENANT001"
      );
      expect(result).toEqual({
        message: "This free reading period has already been deleted.",
        ok: true,
      });
    });

    it("leaves the tag alone when the delete failed", async () => {
      mockDeleteEpisodeFreeWindow.mockResolvedValueOnce({
        message: "Could not delete the free reading period.",
        ok: false,
      });

      const { deleteEpisodeFreeWindowAction } = await import("./actions");
      const result = await deleteEpisodeFreeWindowAction(
        null,
        deleteFormData("018f0e6a-4000-7000-8000-0000000000f1")
      );

      expect(mockUpdateTag).not.toHaveBeenCalled();
      expect(result).toEqual({
        message: "Could not delete the free reading period.",
        ok: false,
      });
    });

    it("refuses a window id that is not one", async () => {
      const { deleteEpisodeFreeWindowAction } = await import("./actions");
      const result = await deleteEpisodeFreeWindowAction(
        null,
        deleteFormData("not-an-id")
      );

      expect(result).toMatchObject({ ok: false });
      expect(mockDeleteEpisodeFreeWindow).not.toHaveBeenCalled();
    });
  });
});

describe("renewEpisodePreviewUrlsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("checks the session against the tenant before reading the URLs", async () => {
    mockRenewEpisodeImageUrls.mockResolvedValueOnce({
      IMG001: "/images/episodes/IMG001?t=fresh",
    });
    const { renewEpisodePreviewUrlsAction } = await import("./actions");

    await expect(
      renewEpisodePreviewUrlsAction(
        "TENANT001",
        "018f0e6a-4000-7000-8000-000000000001"
      )
    ).resolves.toEqual({ IMG001: "/images/episodes/IMG001?t=fresh" });
    expect(mockVerifyAdminSession).toHaveBeenCalledWith("TENANT001");
    expect(mockRenewEpisodeImageUrls).toHaveBeenCalledWith({
      episodeId: "018f0e6a-4000-7000-8000-000000000001",
      tenantId: "TENANT001",
    });
  });

  it("answers no URL for an episode ID that is not one", async () => {
    const { renewEpisodePreviewUrlsAction } = await import("./actions");

    await expect(
      renewEpisodePreviewUrlsAction("TENANT001", "EP001")
    ).resolves.toEqual({});
    expect(mockRenewEpisodeImageUrls).not.toHaveBeenCalled();
  });

  it("answers no URL when the pages could not be read", async () => {
    mockRenewEpisodeImageUrls.mockImplementationOnce(() => Promise.resolve());
    const { renewEpisodePreviewUrlsAction } = await import("./actions");

    await expect(
      renewEpisodePreviewUrlsAction(
        "TENANT001",
        "018f0e6a-4000-7000-8000-000000000001"
      )
    ).resolves.toEqual({});
  });
});
