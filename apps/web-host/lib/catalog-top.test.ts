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
} = vi.hoisted(() => ({
  mockGetSeriesDetail: vi.fn(),
  mockListPublishedLabels: vi.fn(),
  mockListPublishedSeries: vi.fn(),
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
  };
});

const seriesFixture = [
  {
    creatorNames: ["著者A"],
    creators: [],
    labelName: "",
    publicId: "SERIES_1",
    synopsis: "S1",
    title: "シリーズ1",
  },
  {
    creatorNames: ["著者B"],
    creators: [],
    labelName: "",
    publicId: "SERIES_2",
    synopsis: "S2",
    title: "シリーズ2",
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
      title: "第1話",
    },
    {
      orderIndex: 2,
      price: 0,
      publicId: "EP_1_2",
      publishedAt: "2026-03-15T00:00:00Z",
      status: "published",
      title: "第2話",
    },
  ],
  series: {
    creatorNames: ["著者A"],
    labelName: "",
    publicId: "SERIES_1",
    readingPeriodHours: 0,
    synopsis: "",
    title: "シリーズ1",
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
      title: "第1話",
    },
  ],
  series: {
    creatorNames: ["著者B"],
    labelName: "",
    publicId: "SERIES_2",
    readingPeriodHours: 0,
    synopsis: "",
    title: "シリーズ2",
  },
};

describe("catalog-top section loaders", () => {
  beforeEach(() => {
    mockGetSeriesDetail.mockReset();
    mockListPublishedLabels.mockReset();
    mockListPublishedAuthors.mockReset();
    mockListPublishedSeries.mockReset();
  });

  it("getCatalogTopRecommendedSeries は公開シリーズの先頭を返す", async () => {
    mockListPublishedSeries.mockResolvedValue(seriesFixture);

    const result = await getCatalogTopRecommendedSeries("TENANT_001", {
      maxRecommended: 1,
      seriesLimit: 10,
    });

    expect(result.map((item) => item.publicId)).toEqual(["SERIES_1"]);
  });

  it("getCatalogTopNewEpisodes は公開日が新しい順に返す", async () => {
    mockListPublishedSeries.mockResolvedValue(seriesFixture);
    mockGetSeriesDetail.mockImplementation(
      (_tenantId: string, seriesId: string) => {
        if (seriesId === "SERIES_1") {
          return Promise.resolve(detailSeries1);
        }
        return Promise.resolve(detailSeries2);
      }
    );

    const result = await getCatalogTopNewEpisodes("TENANT_001", {
      detailFetchLimit: 4,
      maxNewEpisodes: 4,
      seriesLimit: 10,
    });

    expect(result.map((item) => item.episodeId)).toEqual([
      "EP_2_1",
      "EP_1_2",
      "EP_1_1",
    ]);
  });

  it("getCatalogTopUpdatedSeries は最新エピソード更新順に返す", async () => {
    mockListPublishedSeries.mockResolvedValue(seriesFixture);
    mockGetSeriesDetail.mockImplementation(
      (_tenantId: string, seriesId: string) => {
        if (seriesId === "SERIES_1") {
          return Promise.resolve(detailSeries1);
        }
        return Promise.resolve(detailSeries2);
      }
    );

    const result = await getCatalogTopUpdatedSeries("TENANT_001", {
      detailFetchLimit: 4,
      maxUpdatedSeries: 4,
      seriesLimit: 10,
    });

    expect(result.map((item) => item.seriesId)).toEqual([
      "SERIES_2",
      "SERIES_1",
    ]);
  });

  it("getCatalogTopFeaturedLabels / Authors は公開一覧を返す", async () => {
    mockListPublishedAuthors.mockResolvedValue({
      authors: [
        { id: "AUTHOR_1", name: "著者A", seriesCount: 2 },
        { id: "AUTHOR_2", name: "著者B", seriesCount: 1 },
      ],
      hasNextPage: false,
      page: 1,
      pageSize: 6,
    });
    mockListPublishedLabels.mockResolvedValue([
      {
        eyeCatchImageVariants: [],
        name: "ラベルA",
        publicId: "LABEL_1",
        seriesCount: 3,
      },
    ]);

    await expect(
      getCatalogTopFeaturedAuthors("TENANT_001", { maxAuthors: 6 })
    ).resolves.toEqual([
      { id: "AUTHOR_1", name: "著者A", seriesCount: 2 },
      { id: "AUTHOR_2", name: "著者B", seriesCount: 1 },
    ]);
    await expect(
      getCatalogTopFeaturedLabels("TENANT_001", { maxLabels: 6 })
    ).resolves.toEqual([
      {
        eyeCatchImageVariants: [],
        name: "ラベルA",
        publicId: "LABEL_1",
        seriesCount: 3,
      },
    ]);
  });

  it("詳細が null のシリーズ (非公開化など) を除外して継続する", async () => {
    mockListPublishedSeries.mockResolvedValue([
      {
        creatorNames: [],
        creators: [],
        labelName: "",
        publicId: "SERIES_1",
        synopsis: "",
        title: "シリーズ1",
      },
      {
        creatorNames: [],
        creators: [],
        labelName: "",
        publicId: "SERIES_2",
        synopsis: "",
        title: "シリーズ2",
      },
    ]);
    mockGetSeriesDetail.mockImplementation(
      (_tenantId: string, seriesId: string) => {
        if (seriesId === "SERIES_1") {
          return Promise.resolve(null);
        }
        return Promise.resolve({
          episodes: [
            {
              orderIndex: 1,
              price: 0,
              publicId: "EP_2_1",
              publishedAt: "2026-03-20T00:00:00Z",
              status: "published",
              title: "第1話",
            },
          ],
          series: {
            creatorNames: [],
            labelName: "",
            publicId: "SERIES_2",
            readingPeriodHours: 0,
            synopsis: "",
            title: "シリーズ2",
          },
        });
      }
    );

    const options = {
      detailFetchLimit: 10,
      maxNewEpisodes: 10,
      maxUpdatedSeries: 10,
      seriesLimit: 10,
    };

    await expect(
      getCatalogTopNewEpisodes("TENANT_001", options)
    ).resolves.toEqual([expect.objectContaining({ episodeId: "EP_2_1" })]);
    await expect(
      getCatalogTopUpdatedSeries("TENANT_001", options)
    ).resolves.toEqual([expect.objectContaining({ seriesId: "SERIES_2" })]);
  });
});
