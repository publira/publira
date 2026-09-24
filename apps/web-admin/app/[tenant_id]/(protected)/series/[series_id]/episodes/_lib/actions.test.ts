import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockBulkEditEpisodeCredits,
  mockCreateEpisode,
  mockGetAccessToken,
  mockGetTenantDisplayTimeZone,
  mockListAllEpisodes,
  mockRedirect,
  mockReorderEpisodePage,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockBulkEditEpisodeCredits: vi.fn(),
  mockCreateEpisode: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetTenantDisplayTimeZone: vi.fn(),
  mockListAllEpisodes: vi.fn(),
  mockRedirect: vi.fn(),
  mockReorderEpisodePage: vi.fn(),
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

vi.mock("#lib/episode", () => ({
  bulkEditEpisodeCredits: mockBulkEditEpisodeCredits,
  createEpisode: mockCreateEpisode,
  listAllEpisodes: mockListAllEpisodes,
  reorderEpisodePage: mockReorderEpisodePage,
}));

vi.mock("#lib/tenant-timezone", () => ({
  getTenantDisplayTimeZone: mockGetTenantDisplayTimeZone,
}));

const createEpisodeFormData = (): FormData => {
  const formData = new FormData();
  formData.set("tenant_id", "TENANT001");
  formData.set("series_public_id", "SERIES001");
  formData.set("title", "Episode title");
  formData.set("price", "0");
  formData.set("reading_period_hours", "24");
  formData.set("availability", "");
  formData.set("purchase_availability", "");
  return formData;
};

describe("episode create actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetTenantDisplayTimeZone.mockResolvedValue("UTC");
    // `withAdminSessionReauth` resolves the session before the mutation runs;
    // without a token every Action under test would redirect to /login.
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("creating an episode clears the dashboard tag so the new draft is counted at once", async () => {
    mockCreateEpisode.mockResolvedValueOnce({
      episode: { publicId: "EP001" },
      ok: true,
    });

    const { createEpisodeAction } = await import("./actions");

    await createEpisodeAction(null, createEpisodeFormData());

    // The dashboard counts drafts and lists them in its publishing queue, so a
    // new episode changes what it shows.
    expect(mockUpdateTag).toHaveBeenCalledWith("tenant:TENANT001:dashboard");
    expect(mockRedirect).toHaveBeenCalledWith(
      "/series/SERIES001/episodes/EP001?created=1"
    );
  });

  it("sends the empty availability as following the series", async () => {
    mockCreateEpisode.mockResolvedValueOnce({
      episode: { publicId: "EP001" },
      ok: true,
    });

    const { createEpisodeAction } = await import("./actions");

    await createEpisodeAction(null, createEpisodeFormData());

    expect(mockCreateEpisode).toHaveBeenCalledWith(
      expect.objectContaining({ availability: "" }),
      "en"
    );
  });

  it("sends the surfaces an episode is created for", async () => {
    mockCreateEpisode.mockResolvedValueOnce({
      episode: { publicId: "EP001" },
      ok: true,
    });

    const { createEpisodeAction } = await import("./actions");
    const formData = createEpisodeFormData();
    formData.set("availability", "web");

    await createEpisodeAction(null, formData);

    expect(mockCreateEpisode).toHaveBeenCalledWith(
      expect.objectContaining({ availability: "web" }),
      "en"
    );
  });

  it("refuses surfaces the form could not have offered", async () => {
    const { createEpisodeAction } = await import("./actions");
    const formData = createEpisodeFormData();
    formData.set("availability", "everywhere");

    const result = await createEpisodeAction(null, formData);

    expect(result).toEqual({
      message: "Choose where the episode is shown, or follow the series.",
      mode: "create",
      ok: false,
    });
    expect(mockCreateEpisode).not.toHaveBeenCalled();
  });

  it("sends where an episode is created to be sold", async () => {
    mockCreateEpisode.mockResolvedValueOnce({
      episode: { publicId: "EP001" },
      ok: true,
    });

    const { createEpisodeAction } = await import("./actions");
    const formData = createEpisodeFormData();
    formData.set("purchase_availability", "app");

    await createEpisodeAction(null, formData);

    expect(mockCreateEpisode).toHaveBeenCalledWith(
      expect.objectContaining({ purchaseAvailability: "app" }),
      "en"
    );
  });

  it("refuses a place of sale the form could not have offered", async () => {
    const { createEpisodeAction } = await import("./actions");
    const formData = createEpisodeFormData();
    formData.set("purchase_availability", "everywhere");

    const result = await createEpisodeAction(null, formData);

    expect(result).toEqual({
      message: "Choose where the episode is sold, or follow the series.",
      mode: "create",
      ok: false,
    });
    expect(mockCreateEpisode).not.toHaveBeenCalled();
  });

  it("leaves the cache alone when the episode cannot be created", async () => {
    mockCreateEpisode.mockResolvedValueOnce({
      message: "Could not create the episode.",
      ok: false,
    });

    const { createEpisodeAction } = await import("./actions");

    const result = await createEpisodeAction(null, createEpisodeFormData());

    expect(result).toEqual({
      message: "Could not create the episode.",
      mode: "create",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});

const fortyEpisodes = Array.from({ length: 40 }, (_, index) => ({
  publicId: `EP${String(index + 1).padStart(2, "0")}`,
  title: `Episode ${index + 1}`,
}));

const bulkCreditFormData = (): FormData => {
  const formData = new FormData();
  formData.set("tenant_id", "TENANT001");
  formData.set("series_public_id", "SERIES001");
  formData.set("operation", "replace");
  formData.set(
    "episode_public_ids",
    JSON.stringify(
      fortyEpisodes.slice(0, 11).map((episode) => episode.publicId)
    )
  );
  formData.set("from_creator_public_id", "CREATOR_B");
  formData.set("from_role_public_id", "ROLE_ARTIST");
  formData.set("to_creator_public_id", "CREATOR_C");
  formData.set("to_role_public_id", "ROLE_ARTIST");
  return formData;
};

const setShareFormData = (share: string): FormData => {
  const formData = bulkCreditFormData();
  formData.set("operation", "set_share");
  formData.set("creator_public_id", "CREATOR_B");
  formData.set("role_public_id", "ROLE_ARTIST");
  formData.set("share", share);
  return formData;
};

describe("bulkEditEpisodeCreditsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
    mockListAllEpisodes.mockResolvedValue({
      episodes: fortyEpisodes,
      ok: true,
    });
  });

  it("resolves the checked episodes of a 40-episode series and sends only those public ids", async () => {
    mockBulkEditEpisodeCredits.mockResolvedValueOnce({
      changedEpisodePublicIds: fortyEpisodes
        .slice(0, 11)
        .map((episode) => episode.publicId),
      ok: true,
      unchangedEpisodes: [],
    });

    const { bulkEditEpisodeCreditsAction } = await import("./actions");
    const result = await bulkEditEpisodeCreditsAction(
      null,
      bulkCreditFormData()
    );

    expect(mockBulkEditEpisodeCredits).toHaveBeenCalledWith(
      {
        episodePublicIds: fortyEpisodes
          .slice(0, 11)
          .map((episode) => episode.publicId),
        operation: {
          from: { creatorPublicId: "CREATOR_B", rolePublicId: "ROLE_ARTIST" },
          to: { creatorPublicId: "CREATOR_C", rolePublicId: "ROLE_ARTIST" },
          type: "replace",
        },
        seriesPublicId: "SERIES001",
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(result).toMatchObject({
      ok: true,
    });
    if (!result?.ok) {
      return;
    }
    expect(result.changedEpisodePublicIds).toHaveLength(11);
    expect(result.changedEpisodePublicIds.at(-1)).toBe("EP11");
    expect(result.changedEpisodePublicIds.includes("EP12")).toBe(false);
  });

  it("sends a sparse selection in reading order and drops ids that are not on the series", async () => {
    mockBulkEditEpisodeCredits.mockResolvedValueOnce({
      changedEpisodePublicIds: ["EP01", "EP07", "EP11"],
      ok: true,
      unchangedEpisodes: [],
    });

    const formData = bulkCreditFormData();
    formData.set(
      "episode_public_ids",
      JSON.stringify(["EP11", "MISSING", "EP01", "EP07"])
    );

    const { bulkEditEpisodeCreditsAction } = await import("./actions");
    const result = await bulkEditEpisodeCreditsAction(null, formData);

    expect(mockBulkEditEpisodeCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        episodePublicIds: ["EP01", "EP07", "EP11"],
      }),
      "en"
    );
    expect(result).toMatchObject({ ok: true });
  });

  it("refuses when nothing checked is on the series", async () => {
    const formData = bulkCreditFormData();
    formData.set("episode_public_ids", JSON.stringify(["MISSING"]));

    const { bulkEditEpisodeCreditsAction } = await import("./actions");
    const result = await bulkEditEpisodeCreditsAction(null, formData);

    expect(result).toEqual({
      message: "Choose at least one episode.",
      ok: false,
    });
    expect(mockBulkEditEpisodeCredits).not.toHaveBeenCalled();
  });

  it("sends a set-share with the typed percentage in basis points", async () => {
    mockBulkEditEpisodeCredits.mockResolvedValueOnce({
      changedEpisodePublicIds: ["EP01"],
      ok: true,
      unchangedEpisodes: [],
    });

    const { bulkEditEpisodeCreditsAction } = await import("./actions");
    await bulkEditEpisodeCreditsAction(null, setShareFormData("33.33"));

    expect(mockBulkEditEpisodeCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: {
          credit: { creatorPublicId: "CREATOR_B", rolePublicId: "ROLE_ARTIST" },
          shareBps: 3333,
          type: "set_share",
        },
      }),
      "en"
    );
  });

  it.each(["", "120", "12.345"])(
    "refuses a set-share whose share box holds %j",
    async (share) => {
      const { bulkEditEpisodeCreditsAction } = await import("./actions");
      const result = await bulkEditEpisodeCreditsAction(
        null,
        setShareFormData(share)
      );

      expect(result).toEqual({
        message:
          "Enter each share as a percentage from 0 to 100, with up to two decimal places.",
        ok: false,
      });
      expect(mockBulkEditEpisodeCredits).not.toHaveBeenCalled();
    }
  );
});
