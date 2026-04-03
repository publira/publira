import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as CatalogModule from "./catalog";
import { getCatalogTopData } from "./catalog-top";

const { mockListPublishedAuthors } = vi.hoisted(() => ({
  mockListPublishedAuthors: vi.fn(),
}));

const { mockGetSeriesDetail, mockListPublishedSeries } = vi.hoisted(() => ({
  mockGetSeriesDetail: vi.fn(),
  mockListPublishedSeries: vi.fn(),
}));

vi.mock("./authors", () => ({
  listPublishedAuthors: mockListPublishedAuthors,
}));

vi.mock("./catalog", async () => {
  const original = await vi.importActual<typeof CatalogModule>("./catalog");

  return {
    ...original,
    getSeriesDetail: mockGetSeriesDetail,
    listPublishedSeries: mockListPublishedSeries,
  };
});

describe("catalog-top.getCatalogTopData", () => {
  beforeEach(() => {
    mockGetSeriesDetail.mockReset();
    mockListPublishedAuthors.mockReset();
    mockListPublishedSeries.mockReset();
  });

  it("おすすめ・新着・更新作品を整形して返す", async () => {
    mockListPublishedSeries.mockResolvedValueOnce([
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
    ]);

    mockListPublishedAuthors.mockResolvedValueOnce({
      authors: [
        { id: "AUTHOR_1", name: "著者A", seriesCount: 2 },
        { id: "AUTHOR_2", name: "著者B", seriesCount: 1 },
      ],
      hasNextPage: false,
      page: 1,
      pageSize: 6,
    });

    mockGetSeriesDetail.mockResolvedValueOnce({
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
    });

    mockGetSeriesDetail.mockResolvedValueOnce({
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
    });

    const result = await getCatalogTopData("TENANT_001", {
      detailFetchLimit: 4,
      maxAuthors: 6,
      maxNewEpisodes: 4,
      maxRecommended: 4,
      maxUpdatedSeries: 4,
      seriesLimit: 10,
    });

    expect(result.recommendedSeries.map((item) => item.publicId)).toEqual([
      "SERIES_1",
      "SERIES_2",
    ]);
    expect(result.newEpisodes.map((item) => item.episodeId)).toEqual([
      "EP_2_1",
      "EP_1_2",
      "EP_1_1",
    ]);
    expect(result.updatedSeries.map((item) => item.seriesId)).toEqual([
      "SERIES_2",
      "SERIES_1",
    ]);
    expect(result.featuredAuthors.map((author) => author.id)).toEqual([
      "AUTHOR_1",
      "AUTHOR_2",
    ]);
  });

  it("一部シリーズ詳細の取得失敗を無視して継続する", async () => {
    mockListPublishedSeries.mockResolvedValueOnce([
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

    mockListPublishedAuthors.mockResolvedValueOnce({
      authors: [],
      hasNextPage: false,
      page: 1,
      pageSize: 6,
    });

    mockGetSeriesDetail.mockRejectedValueOnce(new Error("network"));
    mockGetSeriesDetail.mockResolvedValueOnce({
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

    const result = await getCatalogTopData("TENANT_001", {
      detailFetchLimit: 10,
      maxNewEpisodes: 10,
      maxUpdatedSeries: 10,
      seriesLimit: 10,
    });

    expect(result.newEpisodes.map((item) => item.episodeId)).toEqual([
      "EP_2_1",
    ]);
    expect(result.updatedSeries.map((item) => item.seriesId)).toEqual([
      "SERIES_2",
    ]);
  });
});
