import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockBulkEditEpisodeCredits,
  mockCreateEpisode,
  mockCreateSeriesFreeWindows,
  mockGetAccessToken,
  mockGetTenantDisplayTimeZone,
  mockListAllCreators,
  mockListAllEpisodes,
  mockListCreatorRoles,
  mockRedirect,
  mockReorderEpisodePage,
  mockUpdateTag,
  mockVerifyAdminSession,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockBulkEditEpisodeCredits: vi.fn(),
  mockCreateEpisode: vi.fn(),
  mockCreateSeriesFreeWindows: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetTenantDisplayTimeZone: vi.fn(),
  mockListAllCreators: vi.fn(),
  mockListAllEpisodes: vi.fn(),
  mockListCreatorRoles: vi.fn(),
  mockRedirect: vi.fn(),
  mockReorderEpisodePage: vi.fn(),
  mockUpdateTag: vi.fn(),
  mockVerifyAdminSession: vi.fn(),
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

vi.mock("#lib/auth-session", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  verifyAdminSession: mockVerifyAdminSession,
}));

vi.mock("#lib/session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("#lib/creator", () => ({
  listAllCreatorsForTenant: mockListAllCreators,
}));

vi.mock("#lib/creator-roles", () => ({
  listCreatorRolesForTenant: mockListCreatorRoles,
}));

vi.mock("#lib/episode", () => ({
  bulkEditEpisodeCredits: mockBulkEditEpisodeCredits,
  createEpisode: mockCreateEpisode,
  episodesCacheTag: (tenantId: string) => `episodes-${tenantId}`,
  listAllEpisodesForTenant: mockListAllEpisodes,
  reorderEpisodePage: mockReorderEpisodePage,
}));

vi.mock("#lib/episode-free-window", () => ({
  createSeriesFreeWindows: mockCreateSeriesFreeWindows,
  episodeFreeWindowsCacheTag: (tenantId: string) =>
    `episode-free-windows-${tenantId}`,
}));

vi.mock("#lib/tenant-timezone", () => ({
  getTenantDisplayTimeZone: mockGetTenantDisplayTimeZone,
}));

const createEpisodeFormData = (): FormData => {
  const formData = new FormData();
  formData.set("tenant_id", "TENANT001");
  formData.set("series_id", "018f0e6a-2000-7000-8000-000000000001");
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
    // The series' episode list now holds one more row.
    expect(mockUpdateTag).toHaveBeenCalledWith("episodes-TENANT001");
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

  it("sends a publication time that has already passed, which publishes the episode as it is created", async () => {
    mockCreateEpisode.mockResolvedValueOnce({
      episode: { publicId: "EP001" },
      ok: true,
    });
    const formData = createEpisodeFormData();
    formData.set("publish_at", "2000-01-01T00:00:00Z");

    const { createEpisodeAction } = await import("./actions");

    await createEpisodeAction(null, formData);

    expect(mockCreateEpisode).toHaveBeenCalledWith(
      expect.objectContaining({ publishAt: "2000-01-01T00:00:00Z" }),
      "en"
    );
    expect(mockRedirect).toHaveBeenCalledWith(
      "/series/SERIES001/episodes/EP001?created=1"
    );
  });

  it("refuses a publication time that does not parse", async () => {
    const formData = createEpisodeFormData();
    formData.set("publish_at", "not a time");

    const { createEpisodeAction } = await import("./actions");

    const result = await createEpisodeAction(null, formData);

    expect(result).toMatchObject({ mode: "create", ok: false });
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
  id: `018f0e6a-4000-7000-8000-0000000000${String(index + 1).padStart(2, "0")}`,
  publicId: `EP${String(index + 1).padStart(2, "0")}`,
  title: `Episode ${index + 1}`,
}));

const bulkCreditFormData = (): FormData => {
  const formData = new FormData();
  formData.set("tenant_id", "TENANT001");
  formData.set("series_id", "018f0e6a-2000-7000-8000-000000000001");
  formData.set("operation", "replace");
  formData.set(
    "episode_ids",
    JSON.stringify(fortyEpisodes.slice(0, 11).map((episode) => episode.id))
  );
  formData.set("from_creator_id", "018f0e6a-7000-7000-8000-00000000000b");
  formData.set("from_role_id", "018f0e6a-8000-7000-8000-00000000000a");
  formData.set("to_creator_id", "018f0e6a-7000-7000-8000-00000000000c");
  formData.set("to_role_id", "018f0e6a-8000-7000-8000-00000000000a");
  return formData;
};

const setShareFormData = (share: string): FormData => {
  const formData = bulkCreditFormData();
  formData.set("operation", "set_share");
  formData.set("creator_id", "018f0e6a-7000-7000-8000-00000000000b");
  formData.set("role_id", "018f0e6a-8000-7000-8000-00000000000a");
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
      changedEpisodeIds: fortyEpisodes
        .slice(0, 11)
        .map((episode) => episode.id),
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
        episodeIds: fortyEpisodes.slice(0, 11).map((episode) => episode.id),
        operation: {
          from: {
            creatorId: "018f0e6a-7000-7000-8000-00000000000b",
            roleId: "018f0e6a-8000-7000-8000-00000000000a",
          },
          to: {
            creatorId: "018f0e6a-7000-7000-8000-00000000000c",
            roleId: "018f0e6a-8000-7000-8000-00000000000a",
          },
          type: "replace",
        },
        seriesId: "018f0e6a-2000-7000-8000-000000000001",
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("episodes-TENANT001");
    expect(result).toMatchObject({
      ok: true,
    });
    if (!result?.ok) {
      return;
    }
    expect(result.changedEpisodeIds).toHaveLength(11);
    expect(result.changedEpisodeIds.at(-1)).toBe(
      "018f0e6a-4000-7000-8000-000000000011"
    );
    expect(
      result.changedEpisodeIds.includes("018f0e6a-4000-7000-8000-000000000012")
    ).toBe(false);
  });

  it("sends a sparse selection in reading order and drops ids that are not on the series", async () => {
    mockBulkEditEpisodeCredits.mockResolvedValueOnce({
      changedEpisodeIds: [
        "018f0e6a-4000-7000-8000-000000000001",
        "018f0e6a-4000-7000-8000-000000000007",
        "018f0e6a-4000-7000-8000-000000000011",
      ],
      ok: true,
      unchangedEpisodes: [],
    });

    const formData = bulkCreditFormData();
    formData.set(
      "episode_ids",
      JSON.stringify([
        "018f0e6a-4000-7000-8000-000000000011",
        "018f0e6a-4000-7000-8000-0000000000ff",
        "018f0e6a-4000-7000-8000-000000000001",
        "018f0e6a-4000-7000-8000-000000000007",
      ])
    );

    const { bulkEditEpisodeCreditsAction } = await import("./actions");
    const result = await bulkEditEpisodeCreditsAction(null, formData);

    expect(mockBulkEditEpisodeCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        episodeIds: [
          "018f0e6a-4000-7000-8000-000000000001",
          "018f0e6a-4000-7000-8000-000000000007",
          "018f0e6a-4000-7000-8000-000000000011",
        ],
      }),
      "en"
    );
    expect(result).toMatchObject({ ok: true });
  });

  it("refuses when nothing checked is on the series", async () => {
    const formData = bulkCreditFormData();
    formData.set(
      "episode_ids",
      JSON.stringify(["018f0e6a-4000-7000-8000-0000000000ff"])
    );

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
      changedEpisodeIds: ["EP01"],
      ok: true,
      unchangedEpisodes: [],
    });

    const { bulkEditEpisodeCreditsAction } = await import("./actions");
    await bulkEditEpisodeCreditsAction(null, setShareFormData("33.33"));

    expect(mockBulkEditEpisodeCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: {
          credit: {
            creatorId: "018f0e6a-7000-7000-8000-00000000000b",
            roleId: "018f0e6a-8000-7000-8000-00000000000a",
          },
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

const reorderFormData = (): FormData => {
  const formData = new FormData();
  formData.set("tenant_id", "TENANT001");
  formData.set("series_id", "018f0e6a-2000-7000-8000-000000000001");
  formData.set(
    "current_episode_ids",
    JSON.stringify([fortyEpisodes[0]?.id, fortyEpisodes[1]?.id])
  );
  formData.set(
    "ordered_episode_ids",
    JSON.stringify([fortyEpisodes[1]?.id, fortyEpisodes[0]?.id])
  );
  return formData;
};

describe("reorderEpisodesAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("clears the episode tag once the new order is saved", async () => {
    mockReorderEpisodePage.mockResolvedValueOnce({ episodes: [], ok: true });

    const { reorderEpisodesAction } = await import("./actions");
    const result = await reorderEpisodesAction(reorderFormData());

    expect(result).toEqual({ ok: true });
    expect(mockUpdateTag).toHaveBeenCalledWith("episodes-TENANT001");
  });

  it("leaves the cache alone when the order cannot be saved", async () => {
    mockReorderEpisodePage.mockResolvedValueOnce({
      message: "The order could not be saved.",
      ok: false,
    });

    const { reorderEpisodesAction } = await import("./actions");
    await reorderEpisodesAction(reorderFormData());

    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});

describe("listEpisodeCreditRangeOptionsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockListAllEpisodes.mockResolvedValue({
      episodes: fortyEpisodes.slice(0, 2),
      nextToken: "",
      ok: true,
      previousToken: "",
    });
    mockListAllCreators.mockResolvedValue({
      creators: [{ id: "CREATOR001", name: "Example Author" }],
      nextToken: "",
      ok: true,
      previousToken: "",
    });
    mockListCreatorRoles.mockResolvedValue({ creatorRoles: [], ok: true });
  });

  it("answers the episodes, creators, and roles of the tenant it names", async () => {
    const { listEpisodeCreditRangeOptionsAction } = await import("./actions");
    const result = await listEpisodeCreditRangeOptionsAction(
      "TENANT001",
      "018f0e6a-2000-7000-8000-000000000001",
      "en"
    );

    expect(result.creators).toEqual([
      { id: "CREATOR001", name: "Example Author" },
    ]);
    expect(result.episodes).toHaveLength(2);
    expect(mockVerifyAdminSession).toHaveBeenCalledWith("TENANT001");
    expect(mockListAllEpisodes).toHaveBeenCalledWith(
      {
        seriesId: "018f0e6a-2000-7000-8000-000000000001",
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockListAllCreators).toHaveBeenCalledWith("TENANT001", "en");
    expect(mockListCreatorRoles).toHaveBeenCalledWith("TENANT001", "en");
  });
});

const campaignEpisodeId = (n: number) =>
  `018f0e6a-4000-7000-8000-00000000000${String(n)}`;

describe("createSeriesFreeWindowsAction", () => {
  const SERIES_ID = "018f0e6a-2000-7000-8000-000000000001";
  const startsAt = Temporal.Now.instant().add({ hours: 1 }).toString();
  const endsAt = Temporal.Now.instant().add({ hours: 25 }).toString();

  const bulkFormData = (fields: Record<string, string>): FormData => {
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("series_id", SERIES_ID);
    formData.set("starts_at", startsAt);
    formData.set("ends_at", endsAt);
    formData.set("episode_ids", "[]");
    formData.set("first_count", "1");
    for (const [name, value] of Object.entries(fields)) {
      formData.set(name, value);
    }
    return formData;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetTenantDisplayTimeZone.mockResolvedValue("UTC");
    mockGetAccessToken.mockResolvedValue("session-token");
    mockListAllEpisodes.mockResolvedValue({
      episodes: [1, 2, 3].map((n) => ({ id: campaignEpisodeId(n) })),
      ok: true,
    });
    mockCreateSeriesFreeWindows.mockImplementation(
      (input: { episodeIds?: string[] }) =>
        Promise.resolve({
          freeWindows: (input.episodeIds ?? [1, 2, 3]).map(() => ({})),
          ok: true,
        })
    );
  });

  it("schedules the checked episodes in reading order and clears the windows' tag", async () => {
    const { createSeriesFreeWindowsAction } = await import("./actions");
    const result = await createSeriesFreeWindowsAction(
      null,
      bulkFormData({
        episode_ids: JSON.stringify([
          campaignEpisodeId(3),
          campaignEpisodeId(1),
        ]),
        target: "selected",
      })
    );

    expect(mockVerifyAdminSession).toHaveBeenCalledWith("TENANT001");
    expect(mockCreateSeriesFreeWindows).toHaveBeenCalledWith(
      {
        endsAt,
        episodeIds: [campaignEpisodeId(1), campaignEpisodeId(3)],
        seriesId: SERIES_ID,
        startsAt,
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "episode-free-windows-TENANT001"
    );
    expect(result).toEqual({
      message: "Added a free reading period to 2 episodes.",
      ok: true,
    });
  });

  it("names the first episodes of the series", async () => {
    const { createSeriesFreeWindowsAction } = await import("./actions");
    await createSeriesFreeWindowsAction(
      null,
      bulkFormData({ first_count: "2", target: "first" })
    );

    expect(mockCreateSeriesFreeWindows).toHaveBeenCalledWith(
      expect.objectContaining({
        episodeIds: [campaignEpisodeId(1), campaignEpisodeId(2)],
      }),
      "en"
    );
  });

  it("names no episode for the whole series", async () => {
    const { createSeriesFreeWindowsAction } = await import("./actions");
    await createSeriesFreeWindowsAction(null, bulkFormData({ target: "all" }));

    expect(mockCreateSeriesFreeWindows).toHaveBeenCalledWith(
      expect.objectContaining({ episodeIds: undefined }),
      "en"
    );
  });

  it("asks for a check when none of the checked episodes is in the series", async () => {
    const { createSeriesFreeWindowsAction } = await import("./actions");
    const result = await createSeriesFreeWindowsAction(
      null,
      bulkFormData({ episode_ids: "[]", target: "selected" })
    );

    expect(result).toEqual({
      message: "Select at least one episode on the list.",
      ok: false,
    });
    expect(mockCreateSeriesFreeWindows).not.toHaveBeenCalled();
  });

  it("says a series with no episodes has none, rather than asking for a check", async () => {
    mockListAllEpisodes.mockResolvedValueOnce({ episodes: [], ok: true });

    const { createSeriesFreeWindowsAction } = await import("./actions");
    const result = await createSeriesFreeWindowsAction(
      null,
      bulkFormData({ target: "all" })
    );

    expect(result).toEqual({
      message: "This series has no episodes yet.",
      ok: false,
    });
  });

  it("refuses a count of first episodes outside the bound", async () => {
    const { createSeriesFreeWindowsAction } = await import("./actions");
    const result = await createSeriesFreeWindowsAction(
      null,
      bulkFormData({ first_count: "0", target: "first" })
    );

    expect(result).toEqual({
      message: "Enter a number of episodes from 1 to 1000.",
      ok: false,
    });
  });

  it("refuses a target the form could not have offered", async () => {
    const { createSeriesFreeWindowsAction } = await import("./actions");
    const result = await createSeriesFreeWindowsAction(
      null,
      bulkFormData({ target: "random" })
    );

    expect(result).toMatchObject({ ok: false });
    expect(mockCreateSeriesFreeWindows).not.toHaveBeenCalled();
  });

  it("leaves the tag alone when the API refuses the campaign", async () => {
    mockCreateSeriesFreeWindows.mockResolvedValueOnce({
      message: "overlaps",
      ok: false,
    });

    const { createSeriesFreeWindowsAction } = await import("./actions");
    const result = await createSeriesFreeWindowsAction(
      null,
      bulkFormData({ target: "all" })
    );

    expect(result).toEqual({ message: "overlaps", ok: false });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
