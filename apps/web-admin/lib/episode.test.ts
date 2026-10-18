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
  mockDeleteEpisodeEyeCatchImage,
  mockDeleteEpisodeImage,
  mockDeleteEpisodeTranslation,
  mockGetAccessToken,
  mockGetEpisode,
  mockListEpisodeCredits,
  mockListEpisodeImages,
  mockListEpisodes,
  mockReorderEpisodes,
  mockReplaceEpisodeImage,
  mockUpdateEpisodeAvailability,
  mockUpdateEpisodeLayout,
  mockUpdateEpisodePricing,
  mockUpdateEpisodePurchaseAvailability,
  mockUpdateEpisodeTitle,
  mockUploadEpisodeEyeCatchAspectImage,
  mockUploadEpisodeEyeCatchImage,
} = vi.hoisted(() => ({
  mockBulkEditEpisodeCredits: vi.fn(),
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockCreateEpisode: vi.fn(),
  mockDeleteEpisodeEyeCatchImage: vi.fn(),
  mockDeleteEpisodeImage: vi.fn(),
  mockDeleteEpisodeTranslation: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetEpisode: vi.fn(),
  mockListEpisodeCredits: vi.fn(),
  mockListEpisodeImages: vi.fn(),
  mockListEpisodes: vi.fn(),
  mockReorderEpisodes: vi.fn(),
  mockReplaceEpisodeImage: vi.fn(),
  mockUpdateEpisodeAvailability: vi.fn(),
  mockUpdateEpisodeLayout: vi.fn(),
  mockUpdateEpisodePricing: vi.fn(),
  mockUpdateEpisodePurchaseAvailability: vi.fn(),
  mockUpdateEpisodeTitle: vi.fn(),
  mockUploadEpisodeEyeCatchAspectImage: vi.fn(),
  mockUploadEpisodeEyeCatchImage: vi.fn(),
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
      deleteEpisodeEyeCatchImage: mockDeleteEpisodeEyeCatchImage,
      deleteEpisodeImage: mockDeleteEpisodeImage,
      deleteEpisodeTranslation: mockDeleteEpisodeTranslation,
      getEpisode: mockGetEpisode,
      listEpisodeCredits: mockListEpisodeCredits,
      listEpisodeImages: mockListEpisodeImages,
      listEpisodes: mockListEpisodes,
      reorderEpisodes: mockReorderEpisodes,
      replaceEpisodeImage: mockReplaceEpisodeImage,
      updateEpisodeAvailability: mockUpdateEpisodeAvailability,
      updateEpisodeLayout: mockUpdateEpisodeLayout,
      updateEpisodePricing: mockUpdateEpisodePricing,
      updateEpisodePurchaseAvailability: mockUpdateEpisodePurchaseAvailability,
      updateEpisodeTitle: mockUpdateEpisodeTitle,
      uploadEpisodeEyeCatchAspectImage: mockUploadEpisodeEyeCatchAspectImage,
      uploadEpisodeEyeCatchImage: mockUploadEpisodeEyeCatchImage,
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
        eyeCatchImageUpdatedAt: "",
        eyeCatchImageVariants: [],
        id: "EPISODE001-ID",
        orderIndex: 1,
        price: 0,
        publicId: "EPISODE001",
        publishedAt: "",
        readingPeriodHours: 0,
        rentalPeriodHours: 0,
        rentalPrice: 0,
        scheduledAt: "",
        status: "draft",
        title: "EPISODE001",
      },
      layout: { readingDirection: "" },
      ok: true,
      purchaseAvailability: "",
      translations: [],
    });
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it("reads every translation back beside the episode, oldest first", async () => {
    mockGetEpisode.mockResolvedValue({
      episode: episode("EPISODE001", 1),
      translations: [
        { locale: "ja", title: "EPISODE001" },
        { locale: "en", title: "Episode 1 — Morning" },
        // No catalog of this build names it, so no tab could show it.
        { locale: "xx", title: "Unknown" },
      ],
    });

    const { getEpisode } = await import("./episode");
    const result = await getEpisode({
      publicId: "EPISODE001",
      seriesPublicId: "SERIES001",
    });

    expect(result).toMatchObject({
      ok: true,
      translations: [
        { locale: "ja", title: "EPISODE001" },
        { locale: "en", title: "Episode 1 — Morning" },
      ],
    });
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

  // The cache fill itself must not throw, or the request fails before any
  // boundary can render; the exported read throws once outside the scope.
  it("throws an error it cannot classify only outside the cache scope", async () => {
    mockListEpisodeImages.mockRejectedValue(
      new ConnectError("boom", Code.Internal)
    );

    const { listEpisodeImages } = await import("./episode");

    await expect(
      listEpisodeImages(
        { episodeId: "EPISODE001-ID", tenantId: "TENANT001" },
        "en"
      )
    ).rejects.toThrow(Error);
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
        currency: "JPY",
        price: 0,
        publishAt: "",
        purchaseAvailability: "",
        readingPeriodHours: 0,
        rentalPeriodHours: 0,
        rentalPrice: 0,
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
        currency: "JPY",
        price: 0,
        publishAt: "",
        purchaseAvailability: "",
        readingPeriodHours: 0,
        rentalPeriodHours: 0,
        rentalPrice: 0,
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
        currency: "JPY",
        price: 100,
        publishAt: "",
        purchaseAvailability: "app",
        readingPeriodHours: 0,
        rentalPeriodHours: 0,
        rentalPrice: 0,
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

describe("updateEpisodeTitle", () => {
  it("sends the title and reads back the renamed episode", async () => {
    mockUpdateEpisodeTitle.mockResolvedValue({
      episode: { ...episode("EPISODE001", 1), title: "Episode 1 — Morning" },
    });

    const { updateEpisodeTitle } = await import("./episode");
    const result = await updateEpisodeTitle(
      {
        episodeId: "EPISODE001-ID",
        tenantId: "TENANT001",
        title: "Episode 1 — Morning",
      },
      "en"
    );

    expect(mockUpdateEpisodeTitle).toHaveBeenCalledWith(
      {
        episodeId: "EPISODE001-ID",
        tenant: { tenantId: "TENANT001" },
        title: "Episode 1 — Morning",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toMatchObject({
      episode: { publicId: "EPISODE001", title: "Episode 1 — Morning" },
      ok: true,
    });
  });

  it("reports the failure when the API answers no episode", async () => {
    mockUpdateEpisodeTitle.mockResolvedValue({});

    const { updateEpisodeTitle } = await import("./episode");
    const result = await updateEpisodeTitle(
      { episodeId: "EPISODE001-ID", tenantId: "TENANT001", title: "Episode 1" },
      "en"
    );

    expect(result).toEqual({
      message: "Could not update the title. Please try again later.",
      ok: false,
    });
  });

  it("writes the title in the language the save names", async () => {
    mockUpdateEpisodeTitle.mockResolvedValue({
      episode: episode("EPISODE001", 1),
    });

    const { updateEpisodeTitle } = await import("./episode");
    await updateEpisodeTitle(
      {
        episodeId: "EPISODE001-ID",
        tenantId: "TENANT001",
        title: "Episode 1 — Morning",
        translationLocale: "en",
      },
      "en"
    );

    expect(mockUpdateEpisodeTitle).toHaveBeenCalledWith(
      {
        episodeId: "EPISODE001-ID",
        locale: "en",
        tenant: { tenantId: "TENANT001" },
        title: "Episode 1 — Morning",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("words a language the site does not offer", async () => {
    mockUpdateEpisodeTitle.mockRejectedValue(
      new ConnectError(
        "locale must be a locale the tenant offers",
        Code.InvalidArgument,
        undefined,
        [
          {
            desc: BadRequestSchema,
            value: { fieldViolations: [{ field: "locale" }] },
          },
        ]
      )
    );

    const { updateEpisodeTitle } = await import("./episode");
    const result = await updateEpisodeTitle(
      {
        episodeId: "EPISODE001-ID",
        tenantId: "TENANT001",
        title: "Episode 1",
        translationLocale: "ko",
      },
      "en"
    );

    expect(result).toEqual({
      message:
        "This site does not offer that language. Switch it on under Settings first.",
      ok: false,
    });
  });
});

describe("deleteEpisodeTranslation", () => {
  it("deletes the title in the language it names", async () => {
    mockDeleteEpisodeTranslation.mockResolvedValue({ translations: [] });

    const { deleteEpisodeTranslation } = await import("./episode");
    const result = await deleteEpisodeTranslation(
      {
        episodeId: "EPISODE001-ID",
        tenantId: "TENANT001",
        translationLocale: "en",
      },
      "en"
    );

    expect(result).toEqual({ ok: true });
    expect(mockDeleteEpisodeTranslation).toHaveBeenCalledWith(
      {
        episodeId: "EPISODE001-ID",
        locale: "en",
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("says why the last translation cannot be deleted", async () => {
    mockDeleteEpisodeTranslation.mockRejectedValue(
      new ConnectError(
        "an episode must keep at least one translation",
        Code.FailedPrecondition
      )
    );

    const { deleteEpisodeTranslation } = await import("./episode");
    const result = await deleteEpisodeTranslation(
      {
        episodeId: "EPISODE001-ID",
        tenantId: "TENANT001",
        translationLocale: "ja",
      },
      "en"
    );

    expect(result).toEqual({
      message:
        "An episode keeps at least one translation, so its last one cannot be deleted.",
      ok: false,
    });
  });
});

describe("updateEpisodePricing", () => {
  it("sends the price, reading period, and rental and reads back the episode", async () => {
    mockUpdateEpisodePricing.mockResolvedValue({
      episode: {
        ...episode("EPISODE001", 1),
        price: 120,
        readingPeriodHours: 72,
        rentalPeriodHours: 48,
        rentalPrice: 80,
      },
    });

    const { updateEpisodePricing } = await import("./episode");
    const result = await updateEpisodePricing(
      {
        currency: "JPY",
        episodeId: "EPISODE001-ID",
        price: 120,
        readingPeriodHours: 72,
        rentalPeriodHours: 48,
        rentalPrice: 80,
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(mockUpdateEpisodePricing).toHaveBeenCalledWith(
      {
        currency: "JPY",
        episodeId: "EPISODE001-ID",
        price: 120,
        readingPeriodHours: 72,
        rentalPeriodHours: 48,
        rentalPrice: 80,
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toMatchObject({
      episode: {
        price: 120,
        publicId: "EPISODE001",
        readingPeriodHours: 72,
        rentalPeriodHours: 48,
        rentalPrice: 80,
      },
      ok: true,
    });
  });

  // The tenant's currency changed after the form read it, and the API refused
  // the price as an amount of the old one.
  it("asks for the price again when the API refuses its currency", async () => {
    mockUpdateEpisodePricing.mockRejectedValue(
      new ConnectError("currency changed", Code.FailedPrecondition, undefined, [
        {
          desc: BadRequestSchema,
          value: { fieldViolations: [{ field: "currency" }] },
        },
      ])
    );

    const { updateEpisodePricing } = await import("./episode");
    const result = await updateEpisodePricing(
      {
        currency: "JPY",
        episodeId: "EPISODE001-ID",
        price: 500,
        readingPeriodHours: 0,
        rentalPeriodHours: 0,
        rentalPrice: 0,
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({
      message:
        "The tenant's currency changed after this form was opened. Reload the page and enter the price again.",
      ok: false,
    });
  });

  it("reports the failure when the API answers no episode", async () => {
    mockUpdateEpisodePricing.mockResolvedValue({});

    const { updateEpisodePricing } = await import("./episode");
    const result = await updateEpisodePricing(
      {
        currency: "JPY",
        episodeId: "EPISODE001-ID",
        price: 0,
        readingPeriodHours: 0,
        rentalPeriodHours: 0,
        rentalPrice: 0,
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({
      message:
        "Could not update the price and reading period. Please try again later.",
      ok: false,
    });
  });
});

describe("deleteEpisodeImage", () => {
  it("sends the page and reads back the pages left", async () => {
    mockDeleteEpisodeImage.mockResolvedValue({
      images: [
        {
          contentType: "image/webp",
          displayOrder: 1,
          fileSizeBytes: 2048n,
          height: 1600,
          id: "IMAGE002",
          imageUrl: "https://cdn.example.com/2.webp",
          width: 1200,
        },
      ],
    });

    const { deleteEpisodeImage } = await import("./episode");
    const result = await deleteEpisodeImage(
      {
        episodeId: "EPISODE001-ID",
        imageId: "IMAGE001",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(mockDeleteEpisodeImage).toHaveBeenCalledWith(
      {
        episodeId: "EPISODE001-ID",
        imageId: "IMAGE001",
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({
      images: [
        {
          contentType: "image/webp",
          displayOrder: 1,
          fileSizeBytes: "2048",
          height: 1600,
          id: "IMAGE002",
          imageUrl: "https://cdn.example.com/2.webp",
          width: 1200,
        },
      ],
      ok: true,
    });
  });

  // Someone else deleted or replaced the page since the screen was drawn.
  it("says the page is gone when it is not the episode's", async () => {
    mockDeleteEpisodeImage.mockRejectedValue(
      new ConnectError("episode image not found", Code.NotFound)
    );

    const { deleteEpisodeImage } = await import("./episode");
    const result = await deleteEpisodeImage(
      {
        episodeId: "EPISODE001-ID",
        imageId: "IMAGE001",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({
      message: "The page could not be found. Reload the screen and try again.",
      ok: false,
    });
  });
});

describe("replaceEpisodeImage", () => {
  it("sends the image's bytes, name, and type for the page it replaces", async () => {
    mockReplaceEpisodeImage.mockResolvedValue({ images: [] });

    const { replaceEpisodeImage } = await import("./episode");
    const result = await replaceEpisodeImage(
      {
        episodeId: "EPISODE001-ID",
        image: new File(["png"], "page-3.png", { type: "image/png" }),
        imageId: "IMAGE003",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(mockReplaceEpisodeImage).toHaveBeenCalledWith(
      {
        contentType: "image/png",
        data: new TextEncoder().encode("png"),
        episodeId: "EPISODE001-ID",
        filename: "page-3.png",
        imageId: "IMAGE003",
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({ images: [], ok: true });
  });

  it("says the image cannot be used when the API refuses it", async () => {
    mockReplaceEpisodeImage.mockRejectedValue(
      new ConnectError("data: unsupported image", Code.InvalidArgument)
    );

    const { replaceEpisodeImage } = await import("./episode");
    const result = await replaceEpisodeImage(
      {
        episodeId: "EPISODE001-ID",
        image: new File(["text"], "notes.txt", { type: "text/plain" }),
        imageId: "IMAGE003",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({
      message:
        "The image could not be used. Choose a JPEG, PNG, GIF, or WebP image of up to 20MB.",
      ok: false,
    });
  });
});

const imageRejection = (field: string) =>
  new ConnectError("image is too small", Code.InvalidArgument, undefined, [
    { desc: BadRequestSchema, value: { fieldViolations: [{ field }] } },
  ]);

describe("the episode's eye-catch", () => {
  const storedVariant = {
    contentType: "image/webp",
    fileSizeBytes: 1024n,
    height: 3200,
    label: "portrait_2400w",
    url: "https://cdn.example.com/episodes/EPISODE001/3x4.webp",
    variantType: "portrait",
    width: 2400,
  };

  it("reads the stored variants back on the episode, dropping one with no URL", async () => {
    mockGetEpisode.mockResolvedValue({
      episode: {
        ...episode("EPISODE001", 1),
        eyeCatchImageUpdatedAt: "2026-02-01T00:00:00Z",
        eyeCatchImageVariants: [storedVariant, { ...storedVariant, url: "" }],
      },
    });

    const { getEpisode } = await import("./episode");
    const result = await getEpisode({
      publicId: "EPISODE001",
      seriesPublicId: "SERIES001",
    });

    expect(result.ok && result.episode).toMatchObject({
      eyeCatchImageUpdatedAt: "2026-02-01T00:00:00Z",
      eyeCatchImageVariants: [{ ...storedVariant, fileSizeBytes: 1024 }],
    });
  });

  it("uploads a whole eye-catch and reads back what was stored", async () => {
    mockUploadEpisodeEyeCatchImage.mockResolvedValue({
      episode: {
        ...episode("EPISODE001", 1),
        eyeCatchImageUpdatedAt: "2026-02-01T00:00:00Z",
        eyeCatchImageVariants: [storedVariant],
      },
    });

    const { uploadEpisodeEyeCatchImage } = await import("./episode");
    const result = await uploadEpisodeEyeCatchImage(
      {
        episodeId: "EPISODE001-ID",
        imageContentType: "image/png",
        imageData: new Uint8Array([1, 2, 3]),
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(mockUploadEpisodeEyeCatchImage).toHaveBeenCalledWith(
      {
        episodeId: "EPISODE001-ID",
        imageContentType: "image/png",
        imageData: new Uint8Array([1, 2, 3]),
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result.ok && result.episode.eyeCatchImageVariants).toHaveLength(1);
  });

  it("says which image a whole eye-catch needs when the API refuses one", async () => {
    mockUploadEpisodeEyeCatchImage.mockRejectedValue(
      imageRejection("image_data")
    );

    const { uploadEpisodeEyeCatchImage } = await import("./episode");
    const result = await uploadEpisodeEyeCatchImage(
      {
        episodeId: "EPISODE001-ID",
        imageData: new Uint8Array([1]),
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({
      message:
        "Check the image settings. Choose a JPEG, PNG, or WebP image no larger than 10MB and at least 2400x3200px, then try again.",
      ok: false,
    });
  });

  it("replaces one ratio with the frame the editor chose", async () => {
    mockUploadEpisodeEyeCatchAspectImage.mockResolvedValue({
      episode: {
        ...episode("EPISODE001", 1),
        eyeCatchImageVariants: [storedVariant],
      },
    });
    const crop = { height: 900, width: 1600, x: 0, y: 100 };

    const { uploadEpisodeEyeCatchAspectImage } = await import("./episode");
    const result = await uploadEpisodeEyeCatchAspectImage(
      {
        crop,
        episodeId: "EPISODE001-ID",
        imageContentType: "image/png",
        imageData: new Uint8Array([1, 2, 3]),
        tenantId: "TENANT001",
        variantType: "landscape",
      },
      "en"
    );

    expect(mockUploadEpisodeEyeCatchAspectImage).toHaveBeenCalledWith(
      {
        crop,
        episodeId: "EPISODE001-ID",
        imageContentType: "image/png",
        imageData: new Uint8Array([1, 2, 3]),
        tenant: { tenantId: "TENANT001" },
        variantType: "landscape",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result.ok).toBe(true);
  });

  it("leaves the wording of a refused ratio to the slot that sent it", async () => {
    mockUploadEpisodeEyeCatchAspectImage.mockRejectedValue(
      imageRejection("crop")
    );

    const { uploadEpisodeEyeCatchAspectImage } = await import("./episode");
    const result = await uploadEpisodeEyeCatchAspectImage(
      {
        episodeId: "EPISODE001-ID",
        imageData: new Uint8Array([1]),
        tenantId: "TENANT001",
        variantType: "landscape",
      },
      "en"
    );

    expect(result).toEqual({ imageRejected: true, ok: false });
  });

  it("asks for a whole eye-catch first when a ratio is sent for an episode with none", async () => {
    mockUploadEpisodeEyeCatchAspectImage.mockRejectedValue(
      new ConnectError(
        "episode has no eye catch image yet",
        Code.FailedPrecondition
      )
    );

    const { uploadEpisodeEyeCatchAspectImage } = await import("./episode");
    const result = await uploadEpisodeEyeCatchAspectImage(
      {
        episodeId: "EPISODE001-ID",
        imageData: new Uint8Array([1]),
        tenantId: "TENANT001",
        variantType: "square",
      },
      "en"
    );

    expect(result).toEqual({
      message:
        "Register a cover image first. Individual ratios can be replaced once the cover image exists.",
      ok: false,
    });
  });

  it("removes the eye-catch and reads back an episode without one", async () => {
    mockDeleteEpisodeEyeCatchImage.mockResolvedValue({
      episode: episode("EPISODE001", 1),
    });

    const { deleteEpisodeEyeCatchImage } = await import("./episode");
    const result = await deleteEpisodeEyeCatchImage(
      { episodeId: "EPISODE001-ID", tenantId: "TENANT001" },
      "en"
    );

    expect(mockDeleteEpisodeEyeCatchImage).toHaveBeenCalledWith(
      { episodeId: "EPISODE001-ID", tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toMatchObject({
      episode: { eyeCatchImageUpdatedAt: "", eyeCatchImageVariants: [] },
      ok: true,
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
