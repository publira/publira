import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getCatalogTopFeaturedCreators,
  getCatalogTopFeaturedLabels,
  getCatalogTopFeaturedWork,
  getCatalogTopFreeSeries,
  getCatalogTopNewEpisodes,
  getCatalogTopPopularSeries,
  getCatalogTopRecommendedSeries,
  getCatalogTopUpdatedSeries,
  getCatalogTopWeeklySchedule,
} from "./catalog-top";

const { mockListPublishedCreators } = vi.hoisted(() => ({
  mockListPublishedCreators: vi.fn(),
}));

const {
  mockGetSeriesDetail,
  mockListPublishedLabels,
  mockListPublishedSeries,
  mockListRankedSeries,
  mockListRecommendedSeries,
} = vi.hoisted(() => ({
  mockGetSeriesDetail: vi.fn(),
  mockListPublishedLabels: vi.fn(),
  mockListPublishedSeries: vi.fn(),
  mockListRankedSeries: vi.fn(),
  mockListRecommendedSeries: vi.fn(),
}));

vi.mock("./creators", () => ({
  listPublishedCreators: mockListPublishedCreators,
}));

vi.mock("./catalog", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();

  return {
    ...original,
    getSeriesDetail: mockGetSeriesDetail,
    listPublishedLabels: mockListPublishedLabels,
    listPublishedSeries: mockListPublishedSeries,
    listRankedSeries: mockListRankedSeries,
    listRecommendedSeries: mockListRecommendedSeries,
  };
});

const seriesFixture = [
  {
    creatorNames: ["Creator A"],
    creators: [],
    freeEpisodeCount: 2,
    labelName: "",
    publicId: "SERIES_1",
    synopsis: "S1",
    title: "Series 1",
  },
  {
    creatorNames: ["Creator B"],
    creators: [],
    freeEpisodeCount: 0,
    labelName: "",
    publicId: "SERIES_2",
    synopsis: "S2",
    title: "Series 2",
  },
];

const detailSeries1 = {
  episodes: [
    {
      orderIndex: 1,
      price: 0,
      publicId: "EP_1_1",
      publishedAt: "2026-03-01T00:00:00Z",
      status: "published",
      title: "Episode 1",
    },
    {
      orderIndex: 2,
      price: 0,
      publicId: "EP_1_2",
      publishedAt: "2026-03-15T00:00:00Z",
      status: "published",
      title: "Episode 2",
    },
  ],
  series: {
    creatorNames: ["Creator A"],
    labelName: "",
    publicId: "SERIES_1",
    readingPeriodHours: 0,
    synopsis: "",
    title: "Series 1",
  },
};

const detailSeries2 = {
  episodes: [
    {
      orderIndex: 1,
      price: 0,
      publicId: "EP_2_1",
      publishedAt: "2026-03-20T00:00:00Z",
      status: "published",
      title: "Episode 1",
    },
  ],
  series: {
    creatorNames: ["Creator B"],
    labelName: "",
    publicId: "SERIES_2",
    readingPeriodHours: 0,
    synopsis: "",
    title: "Series 2",
  },
};

describe("catalog-top section loaders", () => {
  beforeEach(() => {
    mockGetSeriesDetail.mockReset();
    mockListPublishedLabels.mockReset();
    mockListPublishedCreators.mockReset();
    mockListPublishedSeries.mockReset();
    mockListRankedSeries.mockReset();
    mockListRecommendedSeries.mockReset();
  });

  it("getCatalogTopPopularSeries shows the weekly chart when the batch has ranked the tenant", async () => {
    mockListRankedSeries.mockResolvedValue({
      ok: true,
      value: {
        computedAt: "2026-03-26T21:00:00Z",
        nextToken: "",
        periodEnd: "2026-03-25",
        periodStart: "2026-03-19",
        previousToken: "",
        rankedSeries: [
          { previousRank: 3, rank: 1, series: seriesFixture[1] },
          { rank: 2, series: seriesFixture[0] },
        ],
      },
    });

    const result = await getCatalogTopPopularSeries("TENANT_001", {
      locale: "en",
      maxRanked: 10,
    });

    expect(mockListRankedSeries).toHaveBeenCalledWith("TENANT_001", {
      limit: 10,
      locale: "en",
      period: "weekly",
    });
    expect(mockListRecommendedSeries).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      value: {
        kind: "ranked",
        rankedSeries: [
          { previousRank: 3, rank: 1, series: seriesFixture[1] },
          { rank: 2, series: seriesFixture[0] },
        ],
      },
    });
  });

  it("getCatalogTopPopularSeries falls back to the recommendation order before the first snapshot", async () => {
    mockListRankedSeries.mockResolvedValue({
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
    mockListRecommendedSeries.mockResolvedValue({
      ok: true,
      value: {
        nextToken: "",
        previousToken: "",
        series: [seriesFixture[0], seriesFixture[1]],
      },
    });

    const result = await getCatalogTopPopularSeries("TENANT_001", {
      locale: "en",
      maxRecommended: 6,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        kind: "recommended",
        series: [seriesFixture[0], seriesFixture[1]],
      },
    });
  });

  it("getCatalogTopPopularSeries reports a failed ranking read instead of falling back", async () => {
    mockListRankedSeries.mockResolvedValue({
      message: "Could not load the ranking. Please try again later.",
      ok: false,
    });

    await expect(
      getCatalogTopPopularSeries("TENANT_001", { locale: "en" })
    ).resolves.toEqual({
      message: "Could not load the ranking. Please try again later.",
      ok: false,
    });
    expect(mockListRecommendedSeries).not.toHaveBeenCalled();
  });

  it("getCatalogTopRecommendedSeries keeps the order the ranking decided", async () => {
    // Newest first is what the slot used to show. The server answers with the
    // ranking instead, so a loader that re-sorted or re-sliced here would throw
    // the behavioural signal away.
    mockListRecommendedSeries.mockResolvedValue({
      ok: true,
      value: {
        nextToken: "NEXT",
        previousToken: "",
        series: [seriesFixture[1], seriesFixture[0]],
      },
    });

    const result = await getCatalogTopRecommendedSeries("TENANT_001", {
      locale: "en",
      maxRecommended: 2,
    });

    expect(mockListRecommendedSeries).toHaveBeenCalledWith("TENANT_001", {
      limit: 2,
      locale: "en",
    });
    expect(result.ok && result.value.map((item) => item.publicId)).toEqual([
      "SERIES_2",
      "SERIES_1",
    ]);
  });

  it("getCatalogTopRecommendedSeries reports a failed recommendation read", async () => {
    mockListRecommendedSeries.mockResolvedValue({
      message: "Could not load the recommended works. Please try again later.",
      ok: false,
    });

    await expect(
      getCatalogTopRecommendedSeries("TENANT_001", {
        locale: "en",
        maxRecommended: 6,
      })
    ).resolves.toEqual({
      message: "Could not load the recommended works. Please try again later.",
      ok: false,
    });
  });

  /**
   * The filter is the server's, so the shelf holds whatever it returned: a
   * series whose free window closed is gone from the answer rather than
   * counted out of it here.
   */
  it("getCatalogTopFreeSeries asks for the series a reader can start without paying", async () => {
    mockListPublishedSeries.mockResolvedValue({
      ok: true,
      value: {
        nextToken: "",
        previousToken: "",
        series: [seriesFixture[0]],
      },
    });

    const result = await getCatalogTopFreeSeries("TENANT_001", {
      locale: "en",
      maxFreeSeries: 6,
    });

    expect(mockListPublishedSeries).toHaveBeenCalledWith("TENANT_001", {
      hasFreeEpisodes: true,
      limit: 6,
      locale: "en",
    });
    expect(result).toEqual({ ok: true, value: [seriesFixture[0]] });
  });

  it("getCatalogTopFreeSeries reports a failed catalogue read", async () => {
    mockListPublishedSeries.mockResolvedValue({
      message: "Could not load the series list. Please try again later.",
      ok: false,
    });

    await expect(
      getCatalogTopFreeSeries("TENANT_001", { locale: "en" })
    ).resolves.toEqual({
      message: "Could not load the series list. Please try again later.",
      ok: false,
    });
  });

  it("getCatalogTopFeaturedWork opens on the head of the recommendation order", async () => {
    mockListRecommendedSeries.mockResolvedValue({
      ok: true,
      value: {
        nextToken: "",
        previousToken: "",
        series: [seriesFixture[0], seriesFixture[1]],
      },
    });
    mockGetSeriesDetail.mockResolvedValue({ ok: true, value: detailSeries1 });

    const result = await getCatalogTopFeaturedWork("TENANT_001", {
      locale: "en",
    });

    expect(mockGetSeriesDetail).toHaveBeenCalledWith(
      "TENANT_001",
      "SERIES_1",
      "en"
    );
    expect(result).toEqual({
      ok: true,
      value: {
        creatorNames: ["Creator A"],
        eyeCatchImageVariants: undefined,
        // The newest published episode, not the last one the detail listed.
        latestEpisode: {
          episodeId: "EP_1_2",
          orderIndex: 2,
          publishedAt: "2026-03-15T00:00:00Z",
          title: "Episode 2",
        },
        seriesId: "SERIES_1",
        seriesTitle: "Series 1",
      },
    });
  });

  it("getCatalogTopFeaturedWork has no work to open with on an empty catalogue", async () => {
    mockListRecommendedSeries.mockResolvedValue({
      ok: true,
      value: { nextToken: "", previousToken: "", series: [] },
    });

    await expect(
      getCatalogTopFeaturedWork("TENANT_001", { locale: "en" })
    ).resolves.toEqual({ ok: true, value: null });
    expect(mockGetSeriesDetail).not.toHaveBeenCalled();
  });

  it("getCatalogTopFeaturedWork offers no episode until one is published", async () => {
    mockListRecommendedSeries.mockResolvedValue({
      ok: true,
      value: {
        nextToken: "",
        previousToken: "",
        series: [seriesFixture[0]],
      },
    });
    mockGetSeriesDetail.mockResolvedValue({
      ok: true,
      value: {
        episodes: [
          {
            orderIndex: 1,
            price: 0,
            publicId: "EP_1_1",
            publishedAt: "",
            status: "draft",
            title: "Episode 1",
          },
        ],
        series: detailSeries1.series,
      },
    });

    const result = await getCatalogTopFeaturedWork("TENANT_001", {
      locale: "en",
    });

    expect(result.ok && result.value?.latestEpisode).toBeUndefined();
  });

  it("getCatalogTopFeaturedWork reports a failed recommendation read", async () => {
    mockListRecommendedSeries.mockResolvedValue({
      message: "Could not load the recommended works. Please try again later.",
      ok: false,
    });

    await expect(
      getCatalogTopFeaturedWork("TENANT_001", { locale: "en" })
    ).resolves.toEqual({
      message: "Could not load the recommended works. Please try again later.",
      ok: false,
    });
  });

  it("getCatalogTopNewEpisodes returns in descending order of publication date", async () => {
    mockListPublishedSeries.mockResolvedValue({
      ok: true,
      value: { nextToken: "", previousToken: "", series: seriesFixture },
    });
    mockGetSeriesDetail.mockImplementation(
      (_tenantId: string, seriesId: string) => {
        if (seriesId === "SERIES_1") {
          return Promise.resolve({ ok: true, value: detailSeries1 });
        }
        return Promise.resolve({ ok: true, value: detailSeries2 });
      }
    );

    const result = await getCatalogTopNewEpisodes("TENANT_001", {
      detailFetchLimit: 4,
      locale: "en",
      maxNewEpisodes: 4,
      seriesLimit: 10,
    });

    expect(result.ok && result.value.map((item) => item.episodeId)).toEqual([
      "EP_2_1",
      "EP_1_2",
      "EP_1_1",
    ]);
  });

  it("getCatalogTopUpdatedSeries returns the latest episodes in order of update", async () => {
    mockListPublishedSeries.mockResolvedValue({
      ok: true,
      value: { nextToken: "", previousToken: "", series: seriesFixture },
    });
    mockGetSeriesDetail.mockImplementation(
      (_tenantId: string, seriesId: string) => {
        if (seriesId === "SERIES_1") {
          return Promise.resolve({ ok: true, value: detailSeries1 });
        }
        return Promise.resolve({ ok: true, value: detailSeries2 });
      }
    );

    const result = await getCatalogTopUpdatedSeries("TENANT_001", {
      detailFetchLimit: 4,
      locale: "en",
      maxUpdatedSeries: 4,
      seriesLimit: 10,
    });

    expect(result.ok && result.value.map((item) => item.seriesId)).toEqual([
      "SERIES_2",
      "SERIES_1",
    ]);
  });

  it("getCatalogTopFeaturedLabels / Creators returns public list", async () => {
    mockListPublishedCreators.mockResolvedValue({
      ok: true,
      value: {
        creators: [
          { id: "CREATOR_1", name: "Creator A", seriesCount: 2 },
          { id: "CREATOR_2", name: "Creator B", seriesCount: 1 },
        ],
        nextToken: "",
        previousToken: "",
      },
    });
    mockListPublishedLabels.mockResolvedValue({
      ok: true,
      value: {
        labels: [
          {
            eyeCatchImageVariants: [],
            name: "Label A",
            publicId: "LABEL_1",
            seriesCount: 3,
          },
        ],
        nextToken: "",
        previousToken: "",
      },
    });

    await expect(
      getCatalogTopFeaturedCreators("TENANT_001", {
        locale: "en",
        maxCreators: 6,
      })
    ).resolves.toEqual({
      ok: true,
      value: [
        { id: "CREATOR_1", name: "Creator A", seriesCount: 2 },
        { id: "CREATOR_2", name: "Creator B", seriesCount: 1 },
      ],
    });
    expect(mockListPublishedCreators).toHaveBeenCalledWith("TENANT_001", {
      limit: 6,
      locale: "en",
    });
    await expect(
      getCatalogTopFeaturedLabels("TENANT_001", { locale: "en", maxLabels: 6 })
    ).resolves.toEqual({
      ok: true,
      value: [
        {
          eyeCatchImageVariants: [],
          name: "Label A",
          publicId: "LABEL_1",
          seriesCount: 3,
        },
      ],
    });
  });

  /**
   * The reads below never throw, so a failure has to travel as a value —
   * a section that could not be built must not look like an empty one.
   */
  it("If retrieving the series list fails, the section also returns failure.", async () => {
    mockListPublishedSeries.mockResolvedValue({
      message: "Could not connect to the server. Please try again later.",
      ok: false,
    });

    await expect(
      getCatalogTopNewEpisodes("TENANT_001", {
        locale: "en",
        maxNewEpisodes: 6,
      })
    ).resolves.toEqual({
      message: "Could not connect to the server. Please try again later.",
      ok: false,
    });
  });

  it("If retrieving series details fails, the section also returns failure.", async () => {
    mockListPublishedSeries.mockResolvedValue({
      ok: true,
      value: { nextToken: "", previousToken: "", series: seriesFixture },
    });
    mockGetSeriesDetail.mockResolvedValue({
      message: "Could not load the series. Please try again later.",
      ok: false,
    });

    await expect(
      getCatalogTopUpdatedSeries("TENANT_001", {
        locale: "en",
        maxUpdatedSeries: 6,
      })
    ).resolves.toEqual({
      message: "Could not load the series. Please try again later.",
      ok: false,
    });
  });

  it("Exclude series with null details (e.g. unpublished) and continue", async () => {
    mockListPublishedSeries.mockResolvedValue({
      ok: true,
      value: {
        nextToken: "",
        previousToken: "",
        series: [
          {
            creatorNames: [],
            creators: [],
            labelName: "",
            publicId: "SERIES_1",
            synopsis: "",
            title: "Series 1",
          },
          {
            creatorNames: [],
            creators: [],
            labelName: "",
            publicId: "SERIES_2",
            synopsis: "",
            title: "Series 2",
          },
        ],
      },
    });
    mockGetSeriesDetail.mockImplementation(
      (_tenantId: string, seriesId: string) => {
        if (seriesId === "SERIES_1") {
          return Promise.resolve({ ok: true, value: null });
        }
        return Promise.resolve({
          ok: true,
          value: {
            episodes: [
              {
                orderIndex: 1,
                price: 0,
                publicId: "EP_2_1",
                publishedAt: "2026-03-20T00:00:00Z",
                status: "published",
                title: "Episode 1",
              },
            ],
            series: {
              creatorNames: [],
              labelName: "",
              publicId: "SERIES_2",
              readingPeriodHours: 0,
              synopsis: "",
              title: "Series 2",
            },
          },
        });
      }
    );

    const options = {
      detailFetchLimit: 10,
      locale: "en",
      maxNewEpisodes: 10,
      maxUpdatedSeries: 10,
      seriesLimit: 10,
    } as const;

    await expect(
      getCatalogTopNewEpisodes("TENANT_001", options)
    ).resolves.toEqual({
      ok: true,
      value: [expect.objectContaining({ episodeId: "EP_2_1" })],
    });
    await expect(
      getCatalogTopUpdatedSeries("TENANT_001", options)
    ).resolves.toEqual({
      ok: true,
      value: [expect.objectContaining({ seriesId: "SERIES_2" })],
    });
  });

  it("getCatalogTopWeeklySchedule asks the server for each day of the week in turn", async () => {
    mockListPublishedSeries.mockImplementation(
      (_tenantId: string, { weekday }: { weekday: number }) =>
        Promise.resolve({
          ok: true,
          value: {
            nextToken: "",
            previousToken: "",
            series: weekday === 4 ? [seriesFixture[0]] : [],
          },
        })
    );

    const result = await getCatalogTopWeeklySchedule("TENANT_001", {
      locale: "en",
      maxScheduledSeries: 6,
      timeZone: "Asia/Tokyo",
    });

    expect(
      mockListPublishedSeries.mock.calls.map(([, options]) => options.weekday)
    ).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(mockListPublishedSeries).toHaveBeenCalledWith("TENANT_001", {
      limit: 6,
      locale: "en",
      order: "updated",
      weekday: 0,
    });
    expect(
      result.ok && result.value.days.map((day) => day.series.length)
    ).toEqual([0, 0, 0, 0, 1, 0, 0]);
  });

  /**
   * The day the strip opens on is the tenant's, not the one the process this
   * runs in happens to be on. It is read at fill time and stays put until the
   * `roll-tenant-day` batch drops the entry, which is what keeps the home page
   * prerendered.
   */
  it("getCatalogTopWeeklySchedule opens the strip on the day it is in the tenant's zone", async () => {
    mockListPublishedSeries.mockResolvedValue({
      ok: true,
      value: { nextToken: "", previousToken: "", series: [] },
    });

    vi.useFakeTimers();
    vi.setSystemTime(
      // Sunday 22:00 UTC is already Monday morning in Tokyo.
      Temporal.Instant.from("2026-03-01T22:00:00Z").epochMilliseconds
    );
    try {
      await expect(
        getCatalogTopWeeklySchedule("TENANT_001", {
          locale: "en",
          timeZone: "UTC",
        })
      ).resolves.toMatchObject({ ok: true, value: { openWeekday: 0 } });
      await expect(
        getCatalogTopWeeklySchedule("TENANT_002", {
          locale: "en",
          timeZone: "Asia/Tokyo",
        })
      ).resolves.toMatchObject({ ok: true, value: { openWeekday: 1 } });
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * A silent hole in the strip would read as "nothing publishes that day",
   * which is a different statement from "this could not be loaded".
   */
  it("getCatalogTopWeeklySchedule reports the whole week as unavailable when one day fails", async () => {
    mockListPublishedSeries.mockImplementation(
      (_tenantId: string, { weekday }: { weekday: number }) =>
        Promise.resolve(
          weekday === 3
            ? { message: "The catalog is unavailable.", ok: false }
            : {
                ok: true,
                value: { nextToken: "", previousToken: "", series: [] },
              }
        )
    );

    await expect(
      getCatalogTopWeeklySchedule("TENANT_001", {
        locale: "en",
        timeZone: "Asia/Tokyo",
      })
    ).resolves.toMatchObject({
      message: "The catalog is unavailable.",
      ok: false,
    });
  });
});
