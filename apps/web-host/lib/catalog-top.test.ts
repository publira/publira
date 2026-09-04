import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getCatalogTopFeaturedAuthors,
  getCatalogTopFeaturedLabels,
  getCatalogTopNewEpisodes,
  getCatalogTopRecommendedSeries,
  getCatalogTopUpdatedSeries,
} from "./catalog-top";

const { mockListPublishedAuthors } = vi.hoisted(() => ({
  mockListPublishedAuthors: vi.fn(),
}));

const {
  mockGetSeriesDetail,
  mockListPublishedLabels,
  mockListPublishedSeries,
  mockListRecommendedSeries,
} = vi.hoisted(() => ({
  mockGetSeriesDetail: vi.fn(),
  mockListPublishedLabels: vi.fn(),
  mockListPublishedSeries: vi.fn(),
  mockListRecommendedSeries: vi.fn(),
}));

vi.mock("./authors", () => ({
  listPublishedAuthors: mockListPublishedAuthors,
}));

vi.mock("./catalog", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();

  return {
    ...original,
    getSeriesDetail: mockGetSeriesDetail,
    listPublishedLabels: mockListPublishedLabels,
    listPublishedSeries: mockListPublishedSeries,
    listRecommendedSeries: mockListRecommendedSeries,
  };
});

const seriesFixture = [
  {
    creatorNames: ["Author A"],
    creators: [],
    labelName: "",
    publicId: "SERIES_1",
    synopsis: "S1",
    title: "Series 1",
  },
  {
    creatorNames: ["Author B"],
    creators: [],
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
    creatorNames: ["Author A"],
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
    creatorNames: ["Author B"],
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
    mockListPublishedAuthors.mockReset();
    mockListPublishedSeries.mockReset();
    mockListRecommendedSeries.mockReset();
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

  it("getCatalogTopFeaturedLabels / Authors returns public list", async () => {
    mockListPublishedAuthors.mockResolvedValue({
      ok: true,
      value: {
        authors: [
          { id: "AUTHOR_1", name: "Author A", seriesCount: 2 },
          { id: "AUTHOR_2", name: "Author B", seriesCount: 1 },
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
      getCatalogTopFeaturedAuthors("TENANT_001", {
        locale: "en",
        maxAuthors: 6,
      })
    ).resolves.toEqual({
      ok: true,
      value: [
        { id: "AUTHOR_1", name: "Author A", seriesCount: 2 },
        { id: "AUTHOR_2", name: "Author B", seriesCount: 1 },
      ],
    });
    expect(mockListPublishedAuthors).toHaveBeenCalledWith("TENANT_001", {
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
});
