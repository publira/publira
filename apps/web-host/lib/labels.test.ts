import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getPublishedLabelDetail } from "./labels";

const { mockGetPublishedLabelDetail } = vi.hoisted(() => ({
  mockGetPublishedLabelDetail: vi.fn(),
}));

vi.mock("./api-client", () => ({
  apiClient: {
    catalog: {
      getPublishedLabelDetail: mockGetPublishedLabelDetail,
    },
  },
}));

describe("getPublishedLabelDetail", () => {
  beforeEach(() => {
    mockGetPublishedLabelDetail.mockReset();
  });

  it("レーベル詳細と所属シリーズの 1 ページを返す", async () => {
    mockGetPublishedLabelDetail.mockResolvedValueOnce({
      label: {
        name: "レーベルA",
        publicId: "LABEL_A",
        publishedSeriesCount: 3,
      },
      nextToken: "NEXT_SERIES",
      previousToken: "",
      series: [
        { publicId: "SERIES_1", title: "シリーズ1" },
        { publicId: "SERIES_2", title: "シリーズ2" },
      ],
    });

    const result = await getPublishedLabelDetail(" TENANT_1 ", " LABEL_A ", {
      limit: 12,
      locale: "ja",
      token: "",
    });

    expect(mockGetPublishedLabelDetail).toHaveBeenCalledWith({
      limit: 12,
      publicId: "LABEL_A",
      tenant: { tenantId: "TENANT_1" },
      token: "",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        id: "LABEL_A",
        name: "レーベルA",
        nextToken: "NEXT_SERIES",
        previousToken: "",
        series: [
          { publicId: "SERIES_1", title: "シリーズ1" },
          { publicId: "SERIES_2", title: "シリーズ2" },
        ],
        seriesCount: 3,
      },
    });
  });

  it("publicId の無いシリーズ行は落とす", async () => {
    mockGetPublishedLabelDetail.mockResolvedValueOnce({
      label: {
        name: "レーベルA",
        publicId: "LABEL_A",
        publishedSeriesCount: 1,
      },
      nextToken: "",
      previousToken: "",
      series: [
        { publicId: "  ", title: "欠番" },
        { publicId: "SERIES_1", title: " シリーズ1 " },
      ],
    });

    const result = await getPublishedLabelDetail("TENANT_1", "LABEL_A", {
      locale: "ja",
    });

    expect(result.ok && result.value?.series).toEqual([
      { publicId: "SERIES_1", title: "シリーズ1" },
    ]);
  });

  it("publicId が空のレーベルは null", async () => {
    mockGetPublishedLabelDetail.mockResolvedValueOnce({
      label: {
        name: "レーベルA",
        publicId: "  ",
        publishedSeriesCount: 1,
      },
      nextToken: "",
      previousToken: "",
      series: [],
    });

    await expect(
      getPublishedLabelDetail("TENANT_1", "LABEL_A", { locale: "ja" })
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("label が欠けている場合は null", async () => {
    mockGetPublishedLabelDetail.mockResolvedValueOnce({
      label: undefined,
      nextToken: "",
      previousToken: "",
      series: [],
    });

    await expect(
      getPublishedLabelDetail("TENANT_1", "LABEL_A", { locale: "ja" })
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("API が not_found を返したら null", async () => {
    mockGetPublishedLabelDetail.mockRejectedValueOnce(
      new ConnectError("label not found", Code.NotFound)
    );

    await expect(
      getPublishedLabelDetail("TENANT_1", "UNKNOWN_LABEL", { locale: "ja" })
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("キャッシュ境界で再生成された ConnectError も null になる", async () => {
    const rehydrated = new Error("[not_found] label not found");
    rehydrated.name = "ConnectError";
    mockGetPublishedLabelDetail.mockRejectedValueOnce(rehydrated);

    await expect(
      getPublishedLabelDetail("TENANT_1", "LABEL_A", { locale: "ja" })
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("API が permission_denied を返したら null", async () => {
    mockGetPublishedLabelDetail.mockRejectedValueOnce(
      new ConnectError("label not found", Code.PermissionDenied)
    );

    await expect(
      getPublishedLabelDetail("TENANT_1", "LABEL_A", { locale: "ja" })
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("not_found 以外のエラーは throw せず失敗の値を返す", async () => {
    mockGetPublishedLabelDetail.mockRejectedValueOnce(
      new ConnectError("connect ECONNREFUSED", Code.Unavailable)
    );

    await expect(
      getPublishedLabelDetail("TENANT_1", "LABEL_A", { locale: "ja" })
    ).resolves.toEqual({
      message:
        "サーバーに接続できませんでした。時間をおいて再試行してください。",
      ok: false,
    });
  });
});
