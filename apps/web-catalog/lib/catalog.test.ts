import { beforeEach, describe, expect, it, vi } from "vitest";

import { EpisodeNotFoundError, getEpisodeDetail } from "./catalog";

const { mockGetEpisodeDetail } = vi.hoisted(() => ({
  mockGetEpisodeDetail: vi.fn(),
}));

vi.mock("./api-client", () => ({
  apiClient: {
    catalog: {
      getEpisodeDetail: mockGetEpisodeDetail,
    },
  },
}));

describe("catalog.getEpisodeDetail", () => {
  beforeEach(() => {
    mockGetEpisodeDetail.mockReset();
  });

  it("エピソード詳細と画像を整形して返す", async () => {
    mockGetEpisodeDetail.mockResolvedValueOnce({
      episode: {
        orderIndex: 2,
        price: 300,
        publicId: "EP_001",
        publishedAt: "2026-03-26T00:00:00Z",
        readingPeriodHours: 72,
        scheduledAt: "",
        status: "published",
        title: "第2話",
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
        title: "シリーズタイトル",
      },
    });

    const result = await getEpisodeDetail("TENANT_001", "SERIES_001", "EP_001");

    expect(mockGetEpisodeDetail).toHaveBeenCalledWith({
      publicId: "EP_001",
      tenant: { tenantPublicId: "TENANT_001" },
    });
    expect(result.series).toEqual({
      publicId: "SERIES_001",
      title: "シリーズタイトル",
    });
    expect(result.episode.title).toBe("第2話");
    expect(result.images.map((image) => image.id)).toEqual(["img_1", "img_2"]);
    expect(result.images[0]?.fileSizeBytes).toBe(1024);
  });

  it("episode が欠けている場合は EpisodeNotFoundError", async () => {
    mockGetEpisodeDetail.mockResolvedValueOnce({
      episode: undefined,
      images: [],
      series: {
        publicId: "SERIES_001",
        title: "シリーズタイトル",
      },
    });

    await expect(
      getEpisodeDetail("TENANT_001", "SERIES_001", "EP_001")
    ).rejects.toBeInstanceOf(EpisodeNotFoundError);
  });

  it("URL の series_id とレスポンスが不一致なら EpisodeNotFoundError", async () => {
    mockGetEpisodeDetail.mockResolvedValueOnce({
      episode: {
        orderIndex: 1,
        price: 0,
        publicId: "EP_001",
        publishedAt: "2026-03-26T00:00:00Z",
        readingPeriodHours: 0,
        scheduledAt: "",
        status: "published",
        title: "第1話",
      },
      images: [],
      series: {
        publicId: "SERIES_OTHER",
        title: "別シリーズ",
      },
    });

    await expect(
      getEpisodeDetail("TENANT_001", "SERIES_001", "EP_001")
    ).rejects.toBeInstanceOf(EpisodeNotFoundError);
  });
});
