import {
  CreatorCreditSource,
  ReadingDirection,
  SurfaceAvailability,
} from "@publira/api-client/admin/types";
import {
  BadRequestSchema,
  Code,
  ConnectError,
} from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockVerifyAdminPageSession, mockVerifyAdminSession } = vi.hoisted(
  () => ({
    mockVerifyAdminPageSession: vi.fn(() =>
      Promise.resolve({ locale: "en" as const, tenantId: "TENANT001" })
    ),
    mockVerifyAdminSession: vi.fn(),
  })
);

vi.mock("./admin-page-session", () => ({
  verifyAdminPageSession: mockVerifyAdminPageSession,
}));

vi.mock("./auth-session", () => ({
  verifyAdminSession: mockVerifyAdminSession,
}));

const {
  mockBulkEditEpisodeCredits,
  mockCacheLife,
  mockCacheTag,
  mockCreateEpisode,
  mockGetAccessToken,
  mockGetEpisode,
  mockListEpisodeCredits,
  mockListEpisodeImages,
  mockListEpisodes,
  mockReorderEpisodes,
  mockUpdateEpisodeAvailability,
  mockUpdateEpisodeLayout,
  mockUpdateEpisodePurchaseAvailability,
} = vi.hoisted(() => ({
  mockBulkEditEpisodeCredits: vi.fn(),
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockCreateEpisode: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetEpisode: vi.fn(),
  mockListEpisodeCredits: vi.fn(),
  mockListEpisodeImages: vi.fn(),
  mockListEpisodes: vi.fn(),
  mockReorderEpisodes: vi.fn(),
  mockUpdateEpisodeAvailability: vi.fn(),
  mockUpdateEpisodeLayout: vi.fn(),
  mockUpdateEpisodePurchaseAvailability: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    series: {
      bulkEditEpisodeCredits: mockBulkEditEpisodeCredits,
      createEpisode: mockCreateEpisode,
      getEpisode: mockGetEpisode,
      listEpisodeCredits: mockListEpisodeCredits,
      listEpisodeImages: mockListEpisodeImages,
      listEpisodes: mockListEpisodes,
      reorderEpisodes: mockReorderEpisodes,
      updateEpisodeAvailability: mockUpdateEpisodeAvailability,
      updateEpisodeLayout: mockUpdateEpisodeLayout,
      updateEpisodePurchaseAvailability: mockUpdateEpisodePurchaseAvailability,
    },
  },
  withServiceHeaders: () => ({
    headers: { Authorization: "Bearer service-token" },
  }),
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

const episode = (publicId: string, orderIndex: number) => ({
  id: `${publicId}-ID`,
  orderIndex,
  price: 0,
  publicId,
  publishedAt: "",
  scheduledAt: "",
  status: "draft",
  title: publicId,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mockGetAccessToken.mockResolvedValue("session-token");
});

describe("listEpisodes", () => {
  it("passes the cursor token and the limit through and returns the tokens of the response", async () => {
    mockListEpisodes.mockResolvedValue({
      episodes: [],
      nextToken: "next-page",
      previousToken: "previous-page",
    });

    const { listEpisodes } = await import("./episode");
    const result = await listEpisodes({
      limit: 20,
      seriesId: "SERIES001",
      token: "current-page",
    });

    expect(mockListEpisodes).toHaveBeenCalledWith(
      {
        limit: 20,
        seriesId: "SERIES001",
        tenant: { tenantId: "TENANT001" },
        token: "current-page",
      },
      { headers: { Authorization: "Bearer service-token" } }
    );
    expect(result).toMatchObject({
      nextToken: "next-page",
      ok: true,
      previousToken: "previous-page",
    });
  });

  it("fetches the first page with the default page size and an empty token", async () => {
    mockListEpisodes.mockResolvedValue({ episodes: [] });

    const { listEpisodes } = await import("./episode");
    const result = await listEpisodes({ seriesId: "SERIES001" });

    expect(mockListEpisodes).toHaveBeenCalledWith(
      {
        limit: 20,
        seriesId: "SERIES001",
        tenant: { tenantId: "TENANT001" },
        token: "",
      },
      { headers: { Authorization: "Bearer service-token" } }
    );
    // A response that names no token still answers with empty strings, so the
    // caller never has to branch on their absence.
    expect(result).toMatchObject({
      nextToken: "",
      ok: true,
      previousToken: "",
    });
  });

  it("returns the keyset order of the server without re-sorting it", async () => {
    mockListEpisodes.mockResolvedValue({
      episodes: [episode("EPISODE003", 3), episode("EPISODE001", 1)],
    });

    const { listEpisodes } = await import("./episode");
    const result = await listEpisodes({ seriesId: "SERIES001" });

    expect(result.episodes.map((item) => item.publicId)).toEqual([
      "EPISODE003",
      "EPISODE001",
    ]);
  });

  it("returns a result with no token when the fetch fails", async () => {
    mockListEpisodes.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { listEpisodes } = await import("./episode");
    const result = await listEpisodes({
      seriesId: "SERIES001",
      token: "current-page",
    });

    expect(result).toMatchObject({
      episodes: [],
      nextToken: "",
      ok: false,
      previousToken: "",
    });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("files the page under the episode list tag and the publication tag", async () => {
    mockListEpisodes.mockResolvedValue({ episodes: [] });

    const { episodePublicationCacheTag, episodesCacheTag, listEpisodes } =
      await import("./episode");
    await listEpisodes({ seriesId: "SERIES001" });

    expect(episodesCacheTag("TENANT001")).toBe("episodes-TENANT001");
    expect(episodePublicationCacheTag("TENANT001")).toBe(
      "tenant:TENANT001:series:detail"
    );
    expect(mockCacheTag).toHaveBeenCalledWith("episodes-TENANT001");
    expect(mockCacheTag).toHaveBeenCalledWith("tenant:TENANT001:series:detail");
  });
});

describe("listAllEpisodes", () => {
  it("follows the cursor past the hundredth entry and keeps the order of the server", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      episode(`EPISODE${String(index + 1).padStart(3, "0")}`, index + 1)
    );
    mockListEpisodes
      .mockResolvedValueOnce({
        episodes: firstPage,
        nextToken: "page-2",
      })
      .mockResolvedValueOnce({
        episodes: [episode("EPISODE101", 101)],
        nextToken: "",
      });

    const { listAllEpisodes } = await import("./episode");
    const result = await listAllEpisodes({ seriesId: "SERIES001" });

    expect(mockListEpisodes).toHaveBeenNthCalledWith(
      1,
      {
        limit: 100,
        seriesId: "SERIES001",
        tenant: { tenantId: "TENANT001" },
        token: "",
      },
      { headers: { Authorization: "Bearer service-token" } }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.episodes).toHaveLength(101);
    expect(result.episodes.at(0)?.publicId).toBe("EPISODE001");
    expect(result.episodes.at(-1)?.publicId).toBe("EPISODE101");
  });

  it("returns no partial result when nextToken repeats itself", async () => {
    mockListEpisodes
      .mockResolvedValueOnce({
        episodes: [episode("EPISODE001", 1)],
        nextToken: "page-2",
      })
      .mockResolvedValueOnce({
        episodes: [episode("EPISODE002", 2)],
        nextToken: "page-2",
      });

    const { listAllEpisodes } = await import("./episode");
    const result = await listAllEpisodes({ seriesId: "SERIES001" });

    expect(result).toMatchObject({
      episodes: [],
      ok: false,
    });
  });
});

describe("getEpisode", () => {
  it("calls the single-fetch RPC and returns the episode", async () => {
    mockGetEpisode.mockResolvedValue({
      episode: episode("EPISODE001", 1),
    });

    const { getEpisode } = await import("./episode");
    const result = await getEpisode({
      publicId: "EPISODE001",
      seriesPublicId: "SERIES001",
    });

    expect(mockGetEpisode).toHaveBeenCalledWith(
      {
        publicId: "EPISODE001",
        seriesPublicId: "SERIES001",
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer service-token" } }
    );
    expect(mockListEpisodes).not.toHaveBeenCalled();
    expect(result).toEqual({
      episode: {
        availability: "",
        id: "EPISODE001-ID",
        orderIndex: 1,
        price: 0,
        publicId: "EPISODE001",
        publishedAt: "",
        readingPeriodHours: 0,
        scheduledAt: "",
        status: "draft",
        title: "EPISODE001",
      },
      layout: { readingDirection: "" },
      ok: true,
      purchaseAvailability: "",
    });
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  // The resolved layout rides on `episode`; the form reads the overrides beside
  // it, because following the series is a choice it offers.
  it("reads the episode's own overrides apart from the layout they resolve to", async () => {
    mockGetEpisode.mockResolvedValue({
      episode: {
        ...episode("EPISODE001", 1),
        readingDirection: ReadingDirection.LEFT_TO_RIGHT,
        spreadStartIndex: 0,
      },
      readingDirection: ReadingDirection.LEFT_TO_RIGHT,
    });

    const { getEpisode } = await import("./episode");
    const result = await getEpisode({
      publicId: "EPISODE001",
      seriesPublicId: "SERIES001",
    });

    expect(result).toMatchObject({
      layout: { readingDirection: "ltr", spreadStartIndex: undefined },
      ok: true,
    });
  });

  it("reports an override direction it cannot name", async () => {
    mockGetEpisode.mockResolvedValue({
      episode: episode("EPISODE001", 1),
      readingDirection: 99,
    });

    const { getEpisode } = await import("./episode");
    const result = await getEpisode({
      publicId: "EPISODE001",
      seriesPublicId: "SERIES001",
    });

    expect(result.ok).toBe(false);
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("returns the scheduledAt of a scheduled episode untouched", async () => {
    mockGetEpisode.mockResolvedValue({
      episode: {
        ...episode("EPISODE002", 2),
        scheduledAt: "2030-01-01T01:00:00Z",
        status: "scheduled",
      },
    });

    const { getEpisode } = await import("./episode");
    const result = await getEpisode({
      publicId: "EPISODE002",
      seriesPublicId: "SERIES001",
    });

    expect(result).toMatchObject({
      episode: { scheduledAt: "2030-01-01T01:00:00Z", status: "scheduled" },
      ok: true,
    });
  });

  it("returns notFound for a missing episode and for one outside the tenant", async () => {
    mockGetEpisode.mockRejectedValue(
      new ConnectError("episode not found", Code.NotFound)
    );

    const { getEpisode } = await import("./episode");
    const result = await getEpisode({
      publicId: "EPISODE_MISSING",
      seriesPublicId: "SERIES001",
    });

    expect(result).toEqual({ notFound: true, ok: false });
    // A missing episode is an answer, so the entry stays cacheable.
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it("fails and drops the cache entry when the fetch fails", async () => {
    mockGetEpisode.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { getEpisode } = await import("./episode");
    const result = await getEpisode({
      publicId: "EPISODE001",
      seriesPublicId: "SERIES001",
    });

    expect(result).toEqual({
      message: "Could not connect to the server. Please try again later.",
      ok: false,
    });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("files the episode under the episode tags and the publication tag", async () => {
    mockGetEpisode.mockResolvedValue({
      episode: episode("EPISODE001", 1),
    });

    const { episodeCacheTag, getEpisode } = await import("./episode");
    await getEpisode({ publicId: "EPISODE001", seriesPublicId: "SERIES001" });

    expect(mockCacheTag).toHaveBeenCalledWith("episodes-TENANT001");
    expect(mockCacheTag).toHaveBeenCalledWith("tenant:TENANT001:series:detail");
    expect(mockCacheTag).toHaveBeenCalledWith(
      episodeCacheTag("TENANT001", "EPISODE001-ID")
    );
  });
});

describe("listEpisodeImages", () => {
  it("returns the body images of the episode", async () => {
    mockListEpisodeImages.mockResolvedValue({
      images: [
        {
          contentType: "image/webp",
          displayOrder: 1,
          fileSizeBytes: 2048n,
          height: 1600,
          id: "IMAGE001",
          imageUrl: "https://cdn.example.com/image-001.webp",
          width: 1200,
        },
      ],
    });

    const { listEpisodeImages } = await import("./episode");
    const result = await listEpisodeImages(
      { episodeId: "EPISODE001-ID", tenantId: "TENANT001" },
      "en"
    );

    expect(mockListEpisodeImages).toHaveBeenCalledWith(
      { episodeId: "EPISODE001-ID", tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({
      images: [
        {
          contentType: "image/webp",
          displayOrder: 1,
          fileSizeBytes: "2048",
          height: 1600,
          id: "IMAGE001",
          imageUrl: "https://cdn.example.com/image-001.webp",
          width: 1200,
        },
      ],
      ok: true,
    });
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it("asks for a fresh login and drops the cache entry when there is no session", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { listEpisodeImages } = await import("./episode");
    const result = await listEpisodeImages(
      { episodeId: "EPISODE001-ID", tenantId: "TENANT001" },
      "en"
    );

    expect(mockListEpisodeImages).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      images: [],
      ok: false,
      requiresSignIn: true,
    });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("fails and drops the cache entry when the fetch fails", async () => {
    mockListEpisodeImages.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { listEpisodeImages } = await import("./episode");
    const result = await listEpisodeImages(
      { episodeId: "EPISODE001-ID", tenantId: "TENANT001" },
      "en"
    );

    expect(result).toMatchObject({
      images: [],
      ok: false,
      requiresSignIn: false,
    });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });
});

describe("the surfaces an episode is shown on", () => {
  it("reads the episode's own value, and the empty value where it follows its series", async () => {
    mockListEpisodes.mockResolvedValue({
      episodes: [
        { ...episode("EPISODE001", 1), availability: SurfaceAvailability.APP },
        episode("EPISODE002", 2),
      ],
    });

    const { listEpisodes } = await import("./episode");
    const result = await listEpisodes({ seriesId: "SERIES001" });

    expect(result.episodes.map((item) => item.availability)).toEqual([
      "app",
      "",
    ]);
  });

  // Opening the form on following the series for a value this build cannot
  // name would write that over the episode's own value on the next save.
  it("reports an episode value it cannot name", async () => {
    mockGetEpisode.mockResolvedValue({
      episode: { ...episode("EPISODE001", 1), availability: 99 },
    });

    const { getEpisode } = await import("./episode");
    const result = await getEpisode({
      publicId: "EPISODE001",
      seriesPublicId: "SERIES001",
    });

    expect(result.ok).toBe(false);
  });

  it("creates an episode that follows its series by sending nothing of its own", async () => {
    mockCreateEpisode.mockResolvedValue({ episode: episode("EPISODE001", 1) });

    const { createEpisode } = await import("./episode");
    await createEpisode(
      {
        availability: "",
        price: 0,
        publishAt: "",
        purchaseAvailability: "",
        readingPeriodHours: 0,
        seriesId: "SERIES001",
        tenantId: "TENANT001",
        title: "Episode title",
      },
      "en"
    );

    expect(mockCreateEpisode).toHaveBeenCalledWith(
      expect.objectContaining({ availability: undefined }),
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("creates an episode kept to the surfaces it names", async () => {
    mockCreateEpisode.mockResolvedValue({ episode: episode("EPISODE001", 1) });

    const { createEpisode } = await import("./episode");
    await createEpisode(
      {
        availability: "web",
        price: 0,
        publishAt: "",
        purchaseAvailability: "",
        readingPeriodHours: 0,
        seriesId: "SERIES001",
        tenantId: "TENANT001",
        title: "Episode title",
      },
      "en"
    );

    expect(mockCreateEpisode).toHaveBeenCalledWith(
      expect.objectContaining({ availability: SurfaceAvailability.WEB }),
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("sends the override and reads back what was stored", async () => {
    mockUpdateEpisodeAvailability.mockResolvedValue({
      episode: {
        ...episode("EPISODE001", 1),
        availability: SurfaceAvailability.APP,
      },
    });

    const { updateEpisodeAvailability } = await import("./episode");
    const result = await updateEpisodeAvailability(
      {
        availability: "app",
        episodeId: "EPISODE001",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(mockUpdateEpisodeAvailability).toHaveBeenCalledWith(
      {
        availability: SurfaceAvailability.APP,
        episodeId: "EPISODE001",
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({ availability: "app", ok: true });
  });

  // Unspecified is stored as no value, which is what keeps the episode
  // following its series after the series changes.
  it("sends unspecified to return the episode to its series", async () => {
    mockUpdateEpisodeAvailability.mockResolvedValue({
      episode: episode("EPISODE001", 1),
    });

    const { updateEpisodeAvailability } = await import("./episode");
    const result = await updateEpisodeAvailability(
      {
        availability: "",
        episodeId: "EPISODE001",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(mockUpdateEpisodeAvailability).toHaveBeenCalledWith(
      expect.objectContaining({ availability: undefined }),
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({ availability: "", ok: true });
  });
});

describe("where an episode may be bought", () => {
  it("reads the episode's own value apart from the one it resolves to", async () => {
    mockGetEpisode.mockResolvedValue({
      episode: {
        ...episode("EPISODE001", 1),
        purchaseAvailability: SurfaceAvailability.WEB,
      },
      purchaseAvailability: SurfaceAvailability.APP,
    });

    const { getEpisode } = await import("./episode");
    const result = await getEpisode({
      publicId: "EPISODE001",
      seriesPublicId: "SERIES001",
    });

    expect(result).toMatchObject({ ok: true, purchaseAvailability: "app" });
  });

  it("reads an episode that states nothing as following its series", async () => {
    mockGetEpisode.mockResolvedValue({ episode: episode("EPISODE001", 1) });

    const { getEpisode } = await import("./episode");
    const result = await getEpisode({
      publicId: "EPISODE001",
      seriesPublicId: "SERIES001",
    });

    expect(result).toMatchObject({ ok: true, purchaseAvailability: "" });
  });

  // Opening the form on following the series for a value this build cannot
  // name would write that over the episode's own value on the next save.
  it("reports a value it cannot name", async () => {
    mockGetEpisode.mockResolvedValue({
      episode: episode("EPISODE001", 1),
      purchaseAvailability: 99,
    });

    const { getEpisode } = await import("./episode");
    const result = await getEpisode({
      publicId: "EPISODE001",
      seriesPublicId: "SERIES001",
    });

    expect(result.ok).toBe(false);
  });

  it("creates an episode sold where it names", async () => {
    mockCreateEpisode.mockResolvedValue({ episode: episode("EPISODE001", 1) });

    const { createEpisode } = await import("./episode");
    await createEpisode(
      {
        availability: "",
        price: 100,
        publishAt: "",
        purchaseAvailability: "app",
        readingPeriodHours: 0,
        seriesId: "SERIES001",
        tenantId: "TENANT001",
        title: "Episode title",
      },
      "en"
    );

    expect(mockCreateEpisode).toHaveBeenCalledWith(
      expect.objectContaining({
        purchaseAvailability: SurfaceAvailability.APP,
      }),
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("sends the override and reads back what was stored", async () => {
    mockUpdateEpisodePurchaseAvailability.mockResolvedValue({
      episode: episode("EPISODE001", 1),
      purchaseAvailability: SurfaceAvailability.WEB,
    });

    const { updateEpisodePurchaseAvailability } = await import("./episode");
    const result = await updateEpisodePurchaseAvailability(
      {
        episodeId: "EPISODE001",
        purchaseAvailability: "web",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(mockUpdateEpisodePurchaseAvailability).toHaveBeenCalledWith(
      {
        episodeId: "EPISODE001",
        purchaseAvailability: SurfaceAvailability.WEB,
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({ ok: true, purchaseAvailability: "web" });
  });

  it("sends unspecified to return the episode to its series", async () => {
    mockUpdateEpisodePurchaseAvailability.mockResolvedValue({
      episode: episode("EPISODE001", 1),
      purchaseAvailability: SurfaceAvailability.UNSPECIFIED,
    });

    const { updateEpisodePurchaseAvailability } = await import("./episode");
    const result = await updateEpisodePurchaseAvailability(
      {
        episodeId: "EPISODE001",
        purchaseAvailability: "",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(mockUpdateEpisodePurchaseAvailability).toHaveBeenCalledWith(
      expect.objectContaining({
        purchaseAvailability: SurfaceAvailability.UNSPECIFIED,
      }),
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({ ok: true, purchaseAvailability: "" });
  });
});

describe("updateEpisodeLayout", () => {
  it("sends the overrides and reads back what was stored", async () => {
    mockUpdateEpisodeLayout.mockResolvedValue({
      episode: episode("EPISODE001", 1),
      readingDirection: ReadingDirection.LEFT_TO_RIGHT,
      spreadStartIndex: 0,
    });

    const { updateEpisodeLayout } = await import("./episode");
    const result = await updateEpisodeLayout(
      {
        episodeId: "EPISODE001",
        readingDirection: "ltr",
        spreadStartIndex: 0,
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(mockUpdateEpisodeLayout).toHaveBeenCalledWith(
      {
        episodeId: "EPISODE001",
        readingDirection: ReadingDirection.LEFT_TO_RIGHT,
        spreadStartIndex: 0,
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({
      layout: { readingDirection: "ltr", spreadStartIndex: 0 },
      ok: true,
    });
  });

  // Unspecified and an absent index are stored as no value, which is what keeps
  // the episode following its series after the series changes.
  it("sends nothing of its own for an episode that follows its series", async () => {
    mockUpdateEpisodeLayout.mockResolvedValue({
      episode: episode("EPISODE001", 1),
      readingDirection: ReadingDirection.UNSPECIFIED,
    });

    const { updateEpisodeLayout } = await import("./episode");
    await updateEpisodeLayout(
      {
        episodeId: "EPISODE001",
        readingDirection: "",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(mockUpdateEpisodeLayout).toHaveBeenCalledWith(
      {
        episodeId: "EPISODE001",
        readingDirection: undefined,
        spreadStartIndex: undefined,
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("says the page is past the last one when the server refuses the index", async () => {
    mockUpdateEpisodeLayout.mockRejectedValue(
      new ConnectError(
        "spread_start_index must name one of the episode's pages",
        Code.InvalidArgument,
        undefined,
        [
          {
            desc: BadRequestSchema,
            value: { fieldViolations: [{ field: "spread_start_index" }] },
          },
        ]
      )
    );

    const { updateEpisodeLayout } = await import("./episode");
    const result = await updateEpisodeLayout(
      {
        episodeId: "EPISODE001",
        readingDirection: "",
        spreadStartIndex: 12,
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({
      message:
        "Spreads cannot start past the episode's last page. Choose one of its pages.",
      ok: false,
    });
  });
});

describe("mergeEpisodeOrder", () => {
  it("writes the order within the page back to the same positions in the whole series", async () => {
    const { mergeEpisodeOrder } = await import("./episode");

    expect(
      mergeEpisodeOrder(["A", "B", "C", "D", "E"], ["C", "D"], ["D", "C"])
    ).toEqual(["A", "B", "D", "C", "E"]);
  });

  it("writes when the order within the page still holds even though an episode outside it is gone", async () => {
    const { mergeEpisodeOrder } = await import("./episode");

    expect(mergeEpisodeOrder(["A", "C", "D"], ["C", "D"], ["D", "C"])).toEqual([
      "A",
      "D",
      "C",
    ]);
  });

  it("gives up when the page no longer matches the series", async () => {
    const { mergeEpisodeOrder } = await import("./episode");

    // A page holding an episode that has already been deleted.
    expect(mergeEpisodeOrder(["A", "B"], ["B", "Z"], ["B", "Z"])).toBeNull();
    // A page that returned the same episode twice.
    expect(mergeEpisodeOrder(["A", "B"], ["A", "B"], ["B", "B"])).toBeNull();
    // A page whose row count does not match the one that was on screen.
    expect(mergeEpisodeOrder(["A", "B"], ["A"], ["B", "A"])).toBeNull();
  });

  it("does not write when another episode has slipped into the page", async () => {
    const { mergeEpisodeOrder } = await import("./episode");

    // The screen showed [C, D], and A and B then moved in between them. The ids
    // alone still line up, so pouring them into the slots would give
    // [D, A, B, C] and move rows the operator never touched.
    expect(
      mergeEpisodeOrder(["C", "A", "B", "D"], ["C", "D"], ["D", "C"])
    ).toBeNull();
  });

  it("does not write when the order on screen disagrees with the current one", async () => {
    const { mergeEpisodeOrder } = await import("./episode");

    // The screen showed [C, D], but another change had already swapped them to
    // [D, C].
    expect(
      mergeEpisodeOrder(["A", "B", "D", "C"], ["C", "D"], ["D", "C"])
    ).toBeNull();
  });
});

describe("reorderEpisodePage", () => {
  it("reads the whole series first and then sends every entry with the order of the page merged in", async () => {
    mockListEpisodes
      .mockResolvedValueOnce({
        episodes: [episode("EPISODE001", 1), episode("EPISODE002", 2)],
        nextToken: "page-2",
      })
      .mockResolvedValueOnce({
        episodes: [episode("EPISODE003", 3), episode("EPISODE004", 4)],
        nextToken: "",
      });
    mockReorderEpisodes.mockResolvedValue({ episodes: [] });

    const { reorderEpisodePage } = await import("./episode");
    const result = await reorderEpisodePage(
      {
        currentEpisodeIds: ["EPISODE003-ID", "EPISODE004-ID"],
        episodeIds: ["EPISODE004-ID", "EPISODE003-ID"],
        seriesId: "SERIES001",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result.ok).toBe(true);
    expect(mockReorderEpisodes).toHaveBeenCalledWith(
      {
        episodeIds: [
          "EPISODE001-ID",
          "EPISODE002-ID",
          "EPISODE004-ID",
          "EPISODE003-ID",
        ],
        expectedEpisodeIds: [
          "EPISODE001-ID",
          "EPISODE002-ID",
          "EPISODE003-ID",
          "EPISODE004-ID",
        ],
        seriesId: "SERIES001",
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("does not call the RPC when the order no longer matches", async () => {
    mockListEpisodes.mockResolvedValue({
      episodes: [episode("EPISODE001", 1)],
      nextToken: "",
    });

    const { reorderEpisodePage } = await import("./episode");
    const result = await reorderEpisodePage(
      {
        currentEpisodeIds: ["EPISODE002-ID"],
        episodeIds: ["EPISODE002-ID"],
        seriesId: "SERIES001",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result.ok).toBe(false);
    expect(mockReorderEpisodes).not.toHaveBeenCalled();
  });

  it("does not call the RPC when another operation changed the order of the page meanwhile", async () => {
    // While the screen showed [EPISODE003, EPISODE004], EPISODE001 and
    // EPISODE002 moved in between them.
    mockListEpisodes.mockResolvedValue({
      episodes: [
        episode("EPISODE003", 1),
        episode("EPISODE001", 2),
        episode("EPISODE002", 3),
        episode("EPISODE004", 4),
      ],
      nextToken: "",
    });

    const { reorderEpisodePage } = await import("./episode");
    const result = await reorderEpisodePage(
      {
        currentEpisodeIds: ["EPISODE003-ID", "EPISODE004-ID"],
        episodeIds: ["EPISODE004-ID", "EPISODE003-ID"],
        seriesId: "SERIES001",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result.ok).toBe(false);
    expect(mockReorderEpisodes).not.toHaveBeenCalled();
  });

  it("does not write and asks for a reload when the server reports an ordering conflict", async () => {
    mockListEpisodes.mockResolvedValue({
      episodes: [episode("EPISODE001", 1), episode("EPISODE002", 2)],
      nextToken: "",
    });
    mockReorderEpisodes.mockRejectedValue(
      new ConnectError("episode order has changed", Code.FailedPrecondition)
    );

    const { reorderEpisodePage } = await import("./episode");
    const result = await reorderEpisodePage(
      {
        currentEpisodeIds: ["EPISODE001-ID", "EPISODE002-ID"],
        episodeIds: ["EPISODE002-ID", "EPISODE001-ID"],
        seriesId: "SERIES001",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      message:
        "The episode order could not be updated because another change altered the series. Reload the screen and try again.",
    });
  });

  it("does not call the RPC when reading the series fails", async () => {
    mockListEpisodes.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { reorderEpisodePage } = await import("./episode");
    const result = await reorderEpisodePage(
      {
        currentEpisodeIds: ["EPISODE001-ID"],
        episodeIds: ["EPISODE001-ID"],
        seriesId: "SERIES001",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result.ok).toBe(false);
    expect(mockReorderEpisodes).not.toHaveBeenCalled();
  });
});

describe("listEpisodeCredits", () => {
  it("opens each credit on the internal IDs of its record", async () => {
    // The shape the RPC answers with: a Creator names the person and the role
    // by public ID alone, and the records beside it carry the internal IDs.
    mockListEpisodeCredits.mockResolvedValue({
      creatorCredits: [
        { creatorId: "CREATOR_A", roleId: "ROLE_WRITER", shareBps: 6667 },
        { creatorId: "CREATOR_B", roleId: "ROLE_ARTIST", shareBps: 3333 },
      ],
      creators: [
        {
          id: "",
          publicId: "CREATOR_A_PUBLIC",
          role: { id: "", publicId: "ROLE_WRITER_PUBLIC" },
          source: CreatorCreditSource.SERIES,
        },
        {
          id: "",
          publicId: "CREATOR_B_PUBLIC",
          role: { id: "", publicId: "ROLE_ARTIST_PUBLIC" },
          source: CreatorCreditSource.EPISODE,
        },
      ],
    });

    const { listEpisodeCredits } = await import("./episode");
    const result = await listEpisodeCredits({ episodeId: "EP01" });

    expect(result).toEqual({
      credits: [
        {
          creatorId: "CREATOR_A",
          roleId: "ROLE_WRITER",
          shareBps: 6667,
          source: CreatorCreditSource.SERIES,
        },
        {
          creatorId: "CREATOR_B",
          roleId: "ROLE_ARTIST",
          shareBps: 3333,
          source: CreatorCreditSource.EPISODE,
        },
      ],
      ok: true,
    });
    expect(mockListEpisodeCredits).toHaveBeenCalledWith(
      { episodeId: "EP01", tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer service-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith("episodes-TENANT001");
    expect(mockCacheTag).toHaveBeenCalledWith("episode-TENANT001-EP01");
  });

  it("reports a failed read as a message and drops the entry", async () => {
    mockListEpisodeCredits.mockRejectedValue(
      new ConnectError("boom", Code.Internal)
    );

    const { listEpisodeCredits } = await import("./episode");
    const result = await listEpisodeCredits({ episodeId: "EP01" });

    expect(result.ok).toBe(false);
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });
});

describe("bulkEditEpisodeCredits", () => {
  it("sends the composed public ids and the replace operation", async () => {
    mockBulkEditEpisodeCredits.mockResolvedValue({
      changedEpisodeIds: ["EP01", "EP02"],
      unchangedEpisodes: [{ episodeId: "EP03", reason: 3 }],
    });

    const { bulkEditEpisodeCredits } = await import("./episode");
    const result = await bulkEditEpisodeCredits(
      {
        episodeIds: ["EP01", "EP02", "EP03"],
        operation: {
          from: { creatorId: "CREATOR_B", roleId: "ROLE_ARTIST" },
          to: { creatorId: "CREATOR_C", roleId: "ROLE_ARTIST" },
          type: "replace",
        },
        seriesId: "SERIES001",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(mockBulkEditEpisodeCredits).toHaveBeenCalledWith(
      {
        episodeIds: ["EP01", "EP02", "EP03"],
        operation: {
          case: "replace",
          value: {
            from: { creatorId: "CREATOR_B", roleId: "ROLE_ARTIST" },
            to: { creatorId: "CREATOR_C", roleId: "ROLE_ARTIST" },
          },
        },
        seriesId: "SERIES001",
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({
      changedEpisodeIds: ["EP01", "EP02"],
      ok: true,
      unchangedEpisodes: [
        {
          episodeId: "EP03",
          reason: "credited_on_the_episode",
        },
      ],
    });
  });

  it("maps a duplicate-credit precondition to the selection-edit wording", async () => {
    mockBulkEditEpisodeCredits.mockRejectedValue(
      new ConnectError("already credited", Code.FailedPrecondition)
    );

    const { bulkEditEpisodeCredits } = await import("./episode");
    const result = await bulkEditEpisodeCredits(
      {
        episodeIds: ["EP01"],
        operation: {
          from: { creatorId: "CREATOR_B", roleId: "ROLE_ARTIST" },
          to: { creatorId: "CREATOR_C", roleId: "ROLE_ARTIST" },
          type: "replace",
        },
        seriesId: "SERIES001",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({
      message:
        "Some of the selected episodes already credit the author this would become. Change the replacement or the selection.",
      ok: false,
    });
  });

  it("sends a set-share with the share on the credit", async () => {
    mockBulkEditEpisodeCredits.mockResolvedValue({
      changedEpisodeIds: ["EP01"],
      unchangedEpisodes: [],
    });

    const { bulkEditEpisodeCredits } = await import("./episode");
    await bulkEditEpisodeCredits(
      {
        episodeIds: ["EP01"],
        operation: {
          credit: { creatorId: "CREATOR_B", roleId: "ROLE_ARTIST" },
          shareBps: 3333,
          type: "set_share",
        },
        seriesId: "SERIES001",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(mockBulkEditEpisodeCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: {
          case: "setShare",
          value: {
            credit: {
              creatorId: "CREATOR_B",
              roleId: "ROLE_ARTIST",
              shareBps: 3333,
            },
          },
        },
      }),
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  // The other credits on the range are not on screen, so the server is what
  // finds an episode the new share would take over 100%.
  it("maps a refused set-share to the over-100% wording", async () => {
    mockBulkEditEpisodeCredits.mockRejectedValue(
      new ConnectError(
        "the share_bps total would exceed 10000",
        Code.InvalidArgument
      )
    );

    const { bulkEditEpisodeCredits } = await import("./episode");
    const result = await bulkEditEpisodeCredits(
      {
        episodeIds: ["EP01"],
        operation: {
          credit: { creatorId: "CREATOR_B", roleId: "ROLE_ARTIST" },
          shareBps: 6000,
          type: "set_share",
        },
        seriesId: "SERIES001",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({
      message:
        "The new share would take some of the selected episodes over 100% in total. Lower the share or change the selection.",
      ok: false,
    });
  });
});

describe("the operator check before a shared read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it.each([
    [
      "listEpisodes",
      async () => {
        const { listEpisodes } = await import("./episode");
        return await listEpisodes({ seriesId: "series-1" });
      },
      mockListEpisodes,
    ],
    [
      "listAllEpisodes",
      async () => {
        const { listAllEpisodes } = await import("./episode");
        return await listAllEpisodes({ seriesId: "series-1" });
      },
      mockListEpisodes,
    ],
    [
      "getEpisode",
      async () => {
        const { getEpisode } = await import("./episode");
        return await getEpisode({
          publicId: "EPISODE001",
          seriesPublicId: "SERIES001",
        });
      },
      mockGetEpisode,
    ],
    [
      "listEpisodeCredits",
      async () => {
        const { listEpisodeCredits } = await import("./episode");
        return await listEpisodeCredits({ episodeId: "episode-1" });
      },
      mockListEpisodeCredits,
    ],
  ] as const)(
    "%s confirms the operator of the screen's tenant before reading anything",
    async (_, read, rpc) => {
      const redirect = new Error("NEXT_REDIRECT");
      mockVerifyAdminPageSession.mockRejectedValueOnce(redirect);

      await expect(read()).rejects.toBe(redirect);
      expect(rpc).not.toHaveBeenCalled();
    }
  );
});
