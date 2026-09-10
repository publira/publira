import { Code, ConnectError } from "@publira/api-client/errors";
import {
  EpisodeAccess,
  RankingPeriod,
} from "@publira/api-client/public/catalog";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getEpisodeDetail,
  getEpisodeViewer,
  isPublicEpisodeBody,
  listPublishedSeries,
  listRankedSeries,
  listRelatedSeries,
  toEpisodeAccessState,
} from "./catalog";

const {
  mockGetEpisodeDetail,
  mockListPublishedSeries,
  mockListRankedSeries,
  mockListRelatedSeries,
} = vi.hoisted(() => ({
  mockGetEpisodeDetail: vi.fn(),
  mockListPublishedSeries: vi.fn(),
  mockListRankedSeries: vi.fn(),
  mockListRelatedSeries: vi.fn(),
}));

vi.mock("./api-client", () => ({
  apiClient: {
    catalog: {
      getEpisodeDetail: mockGetEpisodeDetail,
      listPublishedSeries: mockListPublishedSeries,
      listRankedSeries: mockListRankedSeries,
      listRelatedSeries: mockListRelatedSeries,
    },
  },
  buildSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

describe("toEpisodeAccessState", () => {
  it("Copy RPC enum as is", () => {
    expect(toEpisodeAccessState(EpisodeAccess.FREE, 0)).toBe("free");
    expect(toEpisodeAccessState(EpisodeAccess.LOCKED, 500)).toBe("locked");
    expect(toEpisodeAccessState(EpisodeAccess.ENTITLED, 500)).toBe("entitled");
  });

  it("If not specified, fall back to price", () => {
    expect(toEpisodeAccessState(EpisodeAccess.UNSPECIFIED, 0)).toBe("free");
    expect(toEpisodeAccessState(undefined, 500)).toBe("locked");
  });

  it("Publicly display only the free text", () => {
    expect(isPublicEpisodeBody("free")).toBe(true);
    expect(isPublicEpisodeBody("locked")).toBe(false);
    expect(isPublicEpisodeBody("entitled")).toBe(false);
  });
});

describe("catalog.getEpisodeDetail", () => {
  beforeEach(() => {
    mockGetEpisodeDetail.mockReset();
  });

  it("Format and return episode details and images", async () => {
    mockGetEpisodeDetail.mockResolvedValueOnce({
      access: EpisodeAccess.LOCKED,
      episode: {
        orderIndex: 2,
        price: 300,
        publicId: "EP_001",
        publishedAt: "2026-03-26T00:00:00Z",
        readingPeriodHours: 72,
        scheduledAt: "",
        status: "published",
        title: "Episode 2",
      },
      images: [
        {
          contentType: "image/png",
          displayOrder: 2,
          fileSizeBytes: 2048,
          height: 1800,
          id: "img_2",
          imageUrl: "https://cdn.example/img2.png",
          width: 1200,
        },
        {
          contentType: "image/png",
          displayOrder: 1,
          fileSizeBytes: 1024,
          height: 1800,
          id: "img_1",
          imageUrl: "https://cdn.example/img1.png",
          width: 1200,
        },
      ],
      series: {
        publicId: "SERIES_001",
        title: "Series Title",
      },
    });

    const result = await getEpisodeDetail(
      "TENANT_001",
      "SERIES_001",
      "EP_001",
      "en"
    );

    expect(mockGetEpisodeDetail).toHaveBeenCalledWith({
      publicId: "EP_001",
      tenant: { tenantId: "TENANT_001" },
    });
    const detail = result.ok ? result.value : null;
    expect(detail?.series).toEqual({
      publicId: "SERIES_001",
      title: "Series Title",
    });
    expect(detail?.episode.title).toBe("Episode 2");
    expect(detail?.access).toBe("locked");
    expect(detail?.images.map((image) => image.id)).toEqual(["img_1", "img_2"]);
    expect(detail?.images[0]?.fileSizeBytes).toBe(1024);
  });

  it("Carry the episodes either side of this one", async () => {
    mockGetEpisodeDetail.mockResolvedValueOnce({
      access: EpisodeAccess.FREE,
      episode: {
        orderIndex: 2,
        price: 0,
        publicId: "EP_002",
        publishedAt: "2026-03-26T00:00:00Z",
        readingPeriodHours: 0,
        scheduledAt: "",
        status: "published",
        title: "Episode 2",
      },
      images: [],
      // Priced, and free until the window on it closes: the link says free
      // and still knows what it costs afterwards.
      nextEpisode: {
        isFree: true,
        orderIndex: 3,
        price: 500,
        publicId: "EP_003",
        title: "Episode 3",
      },
      previousEpisode: {
        isFree: true,
        orderIndex: 1,
        price: 0,
        publicId: "EP_001",
        title: "Episode 1",
      },
      series: {
        publicId: "SERIES_001",
        title: "Series Title",
      },
    });

    const result = await getEpisodeDetail(
      "TENANT_001",
      "SERIES_001",
      "EP_002",
      "en"
    );

    const detail = result.ok ? result.value : null;
    expect(detail?.previousEpisode).toEqual({
      isFree: true,
      orderIndex: 1,
      price: 0,
      publicId: "EP_001",
      title: "Episode 1",
    });
    expect(detail?.nextEpisode).toEqual({
      isFree: true,
      orderIndex: 3,
      price: 500,
      publicId: "EP_003",
      title: "Episode 3",
    });
  });

  it("Leave the ends of a series with no neighbour", async () => {
    mockGetEpisodeDetail.mockResolvedValueOnce({
      access: EpisodeAccess.FREE,
      episode: {
        orderIndex: 1,
        price: 0,
        publicId: "EP_001",
        publishedAt: "2026-03-26T00:00:00Z",
        readingPeriodHours: 0,
        scheduledAt: "",
        status: "published",
        title: "Episode 1",
      },
      images: [],
      series: {
        publicId: "SERIES_001",
        title: "Series Title",
      },
    });

    const result = await getEpisodeDetail(
      "TENANT_001",
      "SERIES_001",
      "EP_001",
      "en"
    );

    const detail = result.ok ? result.value : null;
    expect(detail?.previousEpisode).toBeUndefined();
    expect(detail?.nextEpisode).toBeUndefined();
  });

  it("null if episode is missing", async () => {
    mockGetEpisodeDetail.mockResolvedValueOnce({
      episode: undefined,
      images: [],
      series: {
        publicId: "SERIES_001",
        title: "Series Title",
      },
    });

    await expect(
      getEpisodeDetail("TENANT_001", "SERIES_001", "EP_001", "en")
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("null if the series_id of the URL and the response do not match", async () => {
    mockGetEpisodeDetail.mockResolvedValueOnce({
      episode: {
        orderIndex: 1,
        price: 0,
        publicId: "EP_001",
        publishedAt: "2026-03-26T00:00:00Z",
        readingPeriodHours: 0,
        scheduledAt: "",
        status: "published",
        title: "Episode 1",
      },
      images: [],
      series: {
        publicId: "SERIES_OTHER",
        title: "Another Series",
      },
    });

    await expect(
      getEpisodeDetail("TENANT_001", "SERIES_001", "EP_001", "en")
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("null if the API returns not_found", async () => {
    mockGetEpisodeDetail.mockRejectedValueOnce(
      new ConnectError("episode not found", Code.NotFound)
    );

    await expect(
      getEpisodeDetail("TENANT_001", "SERIES_001", "EP_001", "en")
    ).resolves.toEqual({ ok: true, value: null });
  });

  // `"use cache"` re-creates a thrown error from name + message, dropping
  // `code`; classification has to survive on the message prefix alone.
  it("ConnectError regenerated at cache boundaries will also be null", async () => {
    const rehydrated = new Error("[not_found] episode not found");
    rehydrated.name = "ConnectError";
    mockGetEpisodeDetail.mockRejectedValueOnce(rehydrated);

    await expect(
      getEpisodeDetail("TENANT_001", "SERIES_001", "EP_001", "en")
    ).resolves.toEqual({ ok: true, value: null });
  });

  // Another tenant's episode comes back as permission_denied, not not_found.
  it("null if the API returns permission_denied", async () => {
    mockGetEpisodeDetail.mockRejectedValueOnce(
      new ConnectError("episode is not published", Code.PermissionDenied)
    );

    await expect(
      getEpisodeDetail("TENANT_001", "SERIES_001", "EP_001", "en")
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("Remove leading and trailing spaces from the identifier and pass it to the API to determine affiliation", async () => {
    mockGetEpisodeDetail.mockResolvedValueOnce({
      access: EpisodeAccess.FREE,
      episode: {
        orderIndex: 1,
        price: 0,
        publicId: "EP_001",
        publishedAt: "2026-03-26T00:00:00Z",
        readingPeriodHours: 0,
        scheduledAt: "",
        status: "published",
        title: "Episode 1",
      },
      images: [],
      series: { publicId: "SERIES_001", title: "Series Title" },
    });

    const result = await getEpisodeDetail(
      " TENANT_001 ",
      " SERIES_001 ",
      " EP_001 ",
      "en"
    );

    expect(mockGetEpisodeDetail).toHaveBeenCalledWith({
      publicId: "EP_001",
      tenant: { tenantId: "TENANT_001" },
    });
    expect(result.ok && result.value?.episode.title).toBe("Episode 1");
  });

  // A `"use cache"` function must not throw: the fill would fail the whole
  // request instead of reaching the awaiting page.
  it("Errors other than not_found are not thrown and return a failure value.", async () => {
    mockGetEpisodeDetail.mockRejectedValueOnce(
      new ConnectError("connect ECONNREFUSED", Code.Unavailable)
    );

    await expect(
      getEpisodeDetail("TENANT_001", "SERIES_001", "EP_001", "en")
    ).resolves.toEqual({
      message: "Could not connect to the server. Please try again later.",
      ok: false,
    });
  });
});

describe("catalog.getEpisodeViewer", () => {
  beforeEach(() => {
    mockGetEpisodeDetail.mockReset();
  });

  it("If there is no session, return locked without RPC", async () => {
    await expect(
      getEpisodeViewer("TENANT_001", "SERIES_001", "EP_010", "", "en")
    ).resolves.toEqual({
      ok: true,
      value: { access: "locked", images: [] },
    });
    expect(mockGetEpisodeDetail).not.toHaveBeenCalled();
  });

  it("Valid ticket returns entitled image with session", async () => {
    mockGetEpisodeDetail.mockResolvedValueOnce({
      access: EpisodeAccess.ENTITLED,
      episode: {
        orderIndex: 10,
        price: 500,
        publicId: "EP_010",
        publishedAt: "2026-03-26T00:00:00Z",
        readingPeriodHours: 72,
        scheduledAt: "",
        status: "published",
        title: "Episode 10",
      },
      images: [
        {
          contentType: "image/png",
          displayOrder: 1,
          fileSizeBytes: 1024,
          height: 1800,
          id: "img_1",
          imageUrl: "https://cdn.example/img1.png",
          width: 1200,
        },
      ],
      series: { publicId: "SERIES_001", title: "Series Title" },
    });

    const result = await getEpisodeViewer(
      "TENANT_001",
      "SERIES_001",
      "EP_010",
      "session-token",
      "en"
    );

    expect(mockGetEpisodeDetail).toHaveBeenCalledWith(
      {
        publicId: "EP_010",
        tenant: { tenantId: "TENANT_001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({
      ok: true,
      value: {
        access: "entitled",
        images: [
          {
            contentType: "image/png",
            displayOrder: 1,
            fileSizeBytes: 1024,
            height: 1800,
            id: "img_1",
            imageUrl: "https://cdn.example/img1.png",
            width: 1200,
          },
        ],
      },
    });
  });

  it("Locked if you are logged in but do not have permissions", async () => {
    mockGetEpisodeDetail.mockResolvedValueOnce({
      access: EpisodeAccess.LOCKED,
      episode: {
        orderIndex: 10,
        price: 500,
        publicId: "EP_010",
        publishedAt: "2026-03-26T00:00:00Z",
        readingPeriodHours: 72,
        scheduledAt: "",
        status: "published",
        title: "Episode 10",
      },
      images: [],
      series: { publicId: "SERIES_001", title: "Series Title" },
    });

    await expect(
      getEpisodeViewer(
        "TENANT_001",
        "SERIES_001",
        "EP_010",
        "session-token",
        "en"
      )
    ).resolves.toEqual({
      ok: true,
      value: { access: "locked", images: [] },
    });
  });

  it("permission_denied should be locked", async () => {
    mockGetEpisodeDetail.mockRejectedValueOnce(
      new ConnectError("episode is not published", Code.PermissionDenied)
    );

    await expect(
      getEpisodeViewer(
        "TENANT_001",
        "SERIES_001",
        "EP_010",
        "session-token",
        "en"
      )
    ).resolves.toEqual({
      ok: true,
      value: { access: "locked", images: [] },
    });
  });

  it("not_found is null", async () => {
    mockGetEpisodeDetail.mockRejectedValueOnce(
      new ConnectError("episode not found", Code.NotFound)
    );

    await expect(
      getEpisodeViewer(
        "TENANT_001",
        "SERIES_001",
        "EP_010",
        "session-token",
        "en"
      )
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("null if the series_id of the URL and the response do not match", async () => {
    mockGetEpisodeDetail.mockResolvedValueOnce({
      access: EpisodeAccess.ENTITLED,
      episode: {
        orderIndex: 10,
        price: 500,
        publicId: "EP_010",
        publishedAt: "2026-03-26T00:00:00Z",
        readingPeriodHours: 72,
        scheduledAt: "",
        status: "published",
        title: "Episode 10",
      },
      images: [],
      series: { publicId: "SERIES_OTHER", title: "Another Series" },
    });

    await expect(
      getEpisodeViewer(
        "TENANT_001",
        "SERIES_001",
        "EP_010",
        "session-token",
        "en"
      )
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("Errors other than not_found are not thrown and return a failure value.", async () => {
    mockGetEpisodeDetail.mockRejectedValueOnce(
      new ConnectError("connect ECONNREFUSED", Code.Unavailable)
    );

    await expect(
      getEpisodeViewer(
        "TENANT_001",
        "SERIES_001",
        "EP_010",
        "session-token",
        "en"
      )
    ).resolves.toEqual({
      message: "Could not connect to the server. Please try again later.",
      ok: false,
    });
  });
});

describe("catalog.listPublishedSeries", () => {
  beforeEach(() => {
    mockListPublishedSeries.mockReset();
  });

  it("Carries how many episodes of a series can be read without paying", async () => {
    mockListPublishedSeries.mockResolvedValueOnce({
      nextToken: "",
      previousToken: "",
      series: [
        {
          creators: [],
          freeEpisodeCount: 3,
          publicId: "SERIES_1",
          synopsis: "S1",
          title: "Series 1",
        },
        {
          creators: [],
          publicId: "SERIES_2",
          synopsis: "S2",
          title: "Series 2",
        },
      ],
    });

    const result = await listPublishedSeries("TENANT_001", {
      limit: 24,
      locale: "en",
    });

    expect(mockListPublishedSeries).toHaveBeenCalledWith({
      hasFreeEpisodes: false,
      limit: 24,
      tenant: { tenantId: "TENANT_001" },
      token: "",
    });
    expect(
      result.ok && result.value.series.map((item) => item.freeEpisodeCount)
    ).toEqual([3, 0]);
  });

  /**
   * The count is settled per read, so a page filtered here would keep a series
   * whose free window closed between the two.
   */
  it("Leaves the free-to-read filter to the server", async () => {
    mockListPublishedSeries.mockResolvedValueOnce({
      nextToken: "",
      previousToken: "",
      series: [],
    });

    await listPublishedSeries("TENANT_001", {
      hasFreeEpisodes: true,
      limit: 6,
      locale: "en",
    });

    expect(mockListPublishedSeries).toHaveBeenCalledWith({
      hasFreeEpisodes: true,
      limit: 6,
      tenant: { tenantId: "TENANT_001" },
      token: "",
    });
  });
});

describe("catalog.listRankedSeries", () => {
  beforeEach(() => {
    mockListRankedSeries.mockReset();
  });

  it("Ask for the period the caller named and keep the positions the snapshot recorded", async () => {
    mockListRankedSeries.mockResolvedValueOnce({
      computedAt: "2026-03-26T21:00:00Z",
      nextToken: "next-token",
      periodEnd: "2026-03-25",
      periodStart: "2026-03-19",
      previousToken: "",
      rankedSeries: [
        {
          previousRank: 4,
          rank: 1,
          series: {
            creators: [{ name: "Author A", publicId: "AUTHOR_1" }],
            publicId: "SERIES_1",
            synopsis: "S1",
            title: "Series 1",
          },
        },
        {
          rank: 3,
          series: {
            creators: [],
            publicId: "SERIES_2",
            synopsis: "S2",
            title: "Series 2",
          },
        },
      ],
    });

    const result = await listRankedSeries("TENANT_001", {
      limit: 10,
      locale: "en",
      period: "weekly",
    });

    expect(mockListRankedSeries).toHaveBeenCalledWith({
      limit: 10,
      period: RankingPeriod.WEEKLY,
      tenant: { tenantId: "TENANT_001" },
      token: "",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        computedAt: "2026-03-26T21:00:00Z",
        nextToken: "next-token",
        periodEnd: "2026-03-25",
        periodStart: "2026-03-19",
        previousToken: "",
        rankedSeries: [
          {
            previousRank: 4,
            rank: 1,
            series: {
              creatorNames: ["Author A"],
              creators: [
                {
                  iconImageUrl: "",
                  name: "Author A",
                  profileText: "",
                  publicId: "AUTHOR_1",
                },
              ],
              eyeCatchImageUpdatedAt: undefined,
              eyeCatchImageVariants: undefined,
              freeEpisodeCount: 0,
              labelName: "",
              labelPublicId: "",
              publicId: "SERIES_1",
              synopsis: "S1",
              title: "Series 1",
            },
          },
          {
            previousRank: undefined,
            rank: 3,
            series: {
              creatorNames: [],
              creators: [],
              eyeCatchImageUpdatedAt: undefined,
              eyeCatchImageVariants: undefined,
              freeEpisodeCount: 0,
              labelName: "",
              labelPublicId: "",
              publicId: "SERIES_2",
              synopsis: "S2",
              title: "Series 2",
            },
          },
        ],
      },
    });
  });

  it("A tenant nothing has ranked yet is an empty chart rather than a failure", async () => {
    mockListRankedSeries.mockResolvedValueOnce({});

    await expect(
      listRankedSeries("TENANT_001", { locale: "en", period: "daily" })
    ).resolves.toEqual({
      ok: true,
      value: {
        computedAt: "",
        nextToken: "",
        periodEnd: "",
        periodStart: "",
        previousToken: "",
        rankedSeries: [],
      },
    });
  });

  it("Errors are not thrown and return a failure value", async () => {
    mockListRankedSeries.mockRejectedValueOnce(
      new ConnectError("connect ECONNREFUSED", Code.Unavailable)
    );

    await expect(
      listRankedSeries("TENANT_001", { locale: "en", period: "daily" })
    ).resolves.toEqual({
      message: "Could not connect to the server. Please try again later.",
      ok: false,
    });
  });
});

describe("catalog.listRelatedSeries", () => {
  beforeEach(() => {
    mockListRelatedSeries.mockReset();
  });

  it("Names the series to relate to and keeps the order the server scored", async () => {
    mockListRelatedSeries.mockResolvedValueOnce({
      nextToken: "next-token",
      previousToken: "",
      series: [
        {
          creators: [{ name: "Jane Doe", publicId: "CREATOR_1" }],
          freeEpisodeCount: 2,
          publicId: "SERIES_2",
          synopsis: "S2",
          title: "Series 2",
        },
        {
          creators: [],
          publicId: "SERIES_3",
          synopsis: "S3",
          title: "Series 3",
        },
      ],
    });

    const result = await listRelatedSeries("  TENANT_001  ", {
      limit: 4,
      locale: "en",
      seriesPublicId: "  SERIES_1  ",
    });

    expect(mockListRelatedSeries).toHaveBeenCalledWith({
      limit: 4,
      seriesPublicId: "SERIES_1",
      tenant: { tenantId: "TENANT_001" },
      token: "",
    });
    expect(
      result.ok && result.value.series.map((item) => item.publicId)
    ).toEqual(["SERIES_2", "SERIES_3"]);
    expect(result.ok && result.value.nextToken).toBe("next-token");
  });

  /**
   * The section hangs under a series that was published when the page read it,
   * so a `not_found` here means it stopped being published in between. An empty
   * strip is that answer; a failure would replace the section with a message
   * about a series the reader is still looking at.
   */
  it("A series that is gone is an empty page rather than a failure", async () => {
    mockListRelatedSeries.mockRejectedValueOnce(
      new ConnectError("series not found", Code.NotFound)
    );

    await expect(
      listRelatedSeries("TENANT_001", {
        locale: "en",
        seriesPublicId: "SERIES_1",
      })
    ).resolves.toEqual({
      ok: true,
      value: { nextToken: "", previousToken: "", series: [] },
    });
  });

  it("Errors are not thrown and return a failure value", async () => {
    mockListRelatedSeries.mockRejectedValueOnce(
      new ConnectError("connect ECONNREFUSED", Code.Unavailable)
    );

    await expect(
      listRelatedSeries("TENANT_001", {
        locale: "en",
        seriesPublicId: "SERIES_1",
      })
    ).resolves.toEqual({
      message: "Could not connect to the server. Please try again later.",
      ok: false,
    });
  });
});
