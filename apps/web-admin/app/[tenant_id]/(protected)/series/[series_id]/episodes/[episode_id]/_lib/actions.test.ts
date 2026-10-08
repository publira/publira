import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockCreateEpisodeFreeWindow,
  mockDeleteEpisodeFreeWindow,
  mockGetAccessToken,
  mockGetEpisode,
  mockGetTenantDisplayTimeZone,
  mockRedirect,
  mockReorderEpisodeImages,
  mockReplaceEpisodeCredits,
  mockUpdateEpisodeAvailability,
  mockUpdateEpisodeLayout,
  mockUpdateEpisodePublishSchedule,
  mockUpdateEpisodePurchaseAvailability,
  mockUpdateTag,
  mockVerifyAdminSession,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockCreateEpisodeFreeWindow: vi.fn(),
  mockDeleteEpisodeFreeWindow: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetEpisode: vi.fn(),
  mockGetTenantDisplayTimeZone: vi.fn(),
  mockRedirect: vi.fn(),
  mockReorderEpisodeImages: vi.fn(),
  mockReplaceEpisodeCredits: vi.fn(),
  mockUpdateEpisodeAvailability: vi.fn(),
  mockUpdateEpisodeLayout: vi.fn(),
  mockUpdateEpisodePublishSchedule: vi.fn(),
  mockUpdateEpisodePurchaseAvailability: vi.fn(),
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

vi.mock("#lib/episode", () => ({
  episodeCacheTag: (tenantId: string, episodeId: string) =>
    `episode-${tenantId}-${episodeId}`,
  episodesCacheTag: (tenantId: string) => `episodes-${tenantId}`,
  getEpisodeForTenant: mockGetEpisode,
  reorderEpisodeImages: mockReorderEpisodeImages,
  replaceEpisodeCredits: mockReplaceEpisodeCredits,
  updateEpisodeAvailability: mockUpdateEpisodeAvailability,
  updateEpisodeLayout: mockUpdateEpisodeLayout,
  updateEpisodePublishSchedule: mockUpdateEpisodePublishSchedule,
  updateEpisodePurchaseAvailability: mockUpdateEpisodePurchaseAvailability,
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
