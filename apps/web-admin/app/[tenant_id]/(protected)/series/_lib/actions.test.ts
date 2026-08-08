import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateSeries, mockRedirect, mockUpdateSeries } = vi.hoisted(() => ({
  mockCreateSeries: vi.fn(),
  mockRedirect: vi.fn(),
  mockUpdateSeries: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("#lib/series", () => ({
  createSeries: mockCreateSeries,
  updateSeries: mockUpdateSeries,
}));

describe("series actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("基本情報更新: 画像未選択でも更新 API を呼び出せる", async () => {
    mockUpdateSeries.mockResolvedValueOnce({
      ok: true,
      series: {
        creatorNames: [],
        creatorPublicIds: [],
        eyeCatchImageUpdatedAt: "",
        eyeCatchImageVariants: [],
        isPublished: true,
        labelName: "Label",
        labelPublicId: "LABEL001",
        publicId: "SERIES001",
        readingPeriodHours: 24,
        synopsis: "Synopsis",
        title: "Title",
      },
    });

    const { updateSeriesAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("public_id", "SERIES001");
    formData.set("title", "Title");
    formData.set("synopsis", "Synopsis");
    formData.set("reading_period_hours", "24");
    formData.set("label_public_id", "LABEL001");
    formData.set("published_at", "2030-01-01T10:00");
    formData.set("clear_eye_catch_image", "0");

    await updateSeriesAction(null, formData);

    expect(mockUpdateSeries).toHaveBeenCalledWith({
      creatorPublicIds: [],
      eyeCatchImageContentType: undefined,
      eyeCatchImageData: undefined,
      isPublished: true,
      labelPublicId: "LABEL001",
      publicId: "SERIES001",
      // "2030-01-01T10:00" is a zone-less wall clock, read as JST (+09:00) —
      // never as the server process's local zone.
      publishedAt: "2030-01-01T01:00:00Z",
      readingPeriodHours: 24,
      synopsis: "Synopsis",
      tenantId: "TENANT001",
      title: "Title",
    });
    expect(mockRedirect).toHaveBeenCalledWith("/series/SERIES001?updated=1");
  });

  it("基本情報更新: オフセット付き published_at はその瞬間のまま送る", async () => {
    mockUpdateSeries.mockResolvedValueOnce({
      ok: true,
      series: {
        creatorNames: [],
        creatorPublicIds: [],
        eyeCatchImageUpdatedAt: "",
        eyeCatchImageVariants: [],
        isPublished: true,
        labelName: "Label",
        labelPublicId: "LABEL001",
        publicId: "SERIES001",
        readingPeriodHours: 24,
        synopsis: "Synopsis",
        title: "Title",
      },
    });

    const { updateSeriesAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("public_id", "SERIES001");
    formData.set("title", "Title");
    formData.set("synopsis", "Synopsis");
    formData.set("reading_period_hours", "24");
    formData.set("label_public_id", "LABEL001");
    formData.set("published_at", "2030-01-01T10:00:00-08:00");

    await updateSeriesAction(null, formData);

    expect(mockUpdateSeries).toHaveBeenCalledWith(
      expect.objectContaining({ publishedAt: "2030-01-01T18:00:00Z" })
    );
  });

  it("基本情報更新: 日時として解釈できない published_at はエラーにする", async () => {
    const { updateSeriesAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("public_id", "SERIES001");
    formData.set("title", "Title");
    formData.set("synopsis", "Synopsis");
    formData.set("reading_period_hours", "24");
    formData.set("label_public_id", "LABEL001");
    formData.set("published_at", "2030-01-01");

    const result = await updateSeriesAction(null, formData);

    expect(result).toEqual({
      message: "公開日時の形式が正しくありません。",
      mode: "update",
      ok: false,
    });
    expect(mockUpdateSeries).not.toHaveBeenCalled();
  });

  it("アイキャッチ更新: 画像も削除指定も無い場合はエラー", async () => {
    const { updateSeriesEyeCatchAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("public_id", "SERIES001");
    formData.set("title", "Title");
    formData.set("synopsis", "Synopsis");
    formData.set("reading_period_hours", "24");
    formData.set("label_public_id", "LABEL001");
    formData.set("clear_eye_catch_image", "0");

    const result = await updateSeriesEyeCatchAction(null, formData);

    expect(result).toEqual({
      message: "画像を選択するか、削除チェックを選んでください。",
      mode: "update",
      ok: false,
    });
    expect(mockUpdateSeries).not.toHaveBeenCalled();
  });
});
