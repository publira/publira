import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getEpisodeDetail } from "./catalog";

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
      tenant: { tenantId: "TENANT_001" },
    });
    const detail = result.ok ? result.value : null;
    expect(detail?.series).toEqual({
      publicId: "SERIES_001",
      title: "シリーズタイトル",
    });
    expect(detail?.episode.title).toBe("第2話");
    expect(detail?.images.map((image) => image.id)).toEqual(["img_1", "img_2"]);
    expect(detail?.images[0]?.fileSizeBytes).toBe(1024);
  });

  it("episode が欠けている場合は null", async () => {
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
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("URL の series_id とレスポンスが不一致なら null", async () => {
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
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("API が not_found を返したら null", async () => {
    mockGetEpisodeDetail.mockRejectedValueOnce(
      new ConnectError("episode not found", Code.NotFound)
    );

    await expect(
      getEpisodeDetail("TENANT_001", "SERIES_001", "EP_001")
    ).resolves.toEqual({ ok: true, value: null });
  });

  // `"use cache"` re-creates a thrown error from name + message, dropping
  // `code`; classification has to survive on the message prefix alone.
  it("キャッシュ境界で再生成された ConnectError も null になる", async () => {
    const rehydrated = new Error("[not_found] episode not found");
    rehydrated.name = "ConnectError";
    mockGetEpisodeDetail.mockRejectedValueOnce(rehydrated);

    await expect(
      getEpisodeDetail("TENANT_001", "SERIES_001", "EP_001")
    ).resolves.toEqual({ ok: true, value: null });
  });

  // Another tenant's episode comes back as permission_denied, not not_found.
  it("API が permission_denied を返したら null", async () => {
    mockGetEpisodeDetail.mockRejectedValueOnce(
      new ConnectError("episode is not published", Code.PermissionDenied)
    );

    await expect(
      getEpisodeDetail("TENANT_001", "SERIES_001", "EP_001")
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("識別子の前後空白を除去して API に渡し所属判定する", async () => {
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
      series: { publicId: "SERIES_001", title: "シリーズタイトル" },
    });

    const result = await getEpisodeDetail(
      " TENANT_001 ",
      " SERIES_001 ",
      " EP_001 "
    );

    expect(mockGetEpisodeDetail).toHaveBeenCalledWith({
      publicId: "EP_001",
      tenant: { tenantId: "TENANT_001" },
    });
    expect(result.ok && result.value?.episode.title).toBe("第1話");
  });

  // A `"use cache"` function must not throw: the fill would fail the whole
  // request instead of reaching the awaiting page (#672).
  it("not_found 以外のエラーは throw せず失敗の値を返す", async () => {
    mockGetEpisodeDetail.mockRejectedValueOnce(
      new ConnectError("connect ECONNREFUSED", Code.Unavailable)
    );

    await expect(
      getEpisodeDetail("TENANT_001", "SERIES_001", "EP_001")
    ).resolves.toEqual({
      message:
        "サーバーに接続できませんでした。時間をおいて再試行してください。",
      ok: false,
    });
  });
});
