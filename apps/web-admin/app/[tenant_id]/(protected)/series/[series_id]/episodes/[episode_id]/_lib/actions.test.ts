import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockGetAccessToken,
  mockGetTenantDisplayTimeZone,
  mockRedirect,
  mockReorderEpisodeImages,
  mockUpdateEpisodePublishSchedule,
  mockUploadEpisodePages,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetTenantDisplayTimeZone: vi.fn(),
  mockRedirect: vi.fn(),
  mockReorderEpisodeImages: vi.fn(),
  mockUpdateEpisodePublishSchedule: vi.fn(),
  mockUploadEpisodePages: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("#lib/episode", () => ({
  reorderEpisodeImages: mockReorderEpisodeImages,
  updateEpisodePublishSchedule: mockUpdateEpisodePublishSchedule,
  uploadEpisodePages: mockUploadEpisodePages,
}));

vi.mock("#lib/tenant-timezone", () => ({
  getTenantDisplayTimeZone: mockGetTenantDisplayTimeZone,
}));

describe("episode actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetTenantDisplayTimeZone.mockResolvedValue("Asia/Tokyo");
    // `withAdminSessionReauth` resolves the session before the mutation runs;
    // without a token every Action under test would redirect to /login.
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("公開スケジュール更新: hidden パラメータ不足でエラーを返す", async () => {
    const { updateEpisodeScheduleAction } = await import("./actions");
    const formData = new FormData();
    formData.set("series_public_id", "SERIES001");
    formData.set("episode_public_id", "EP001");
    formData.set("publish_at", "2026-06-01T10:00:00Z");

    const result = await updateEpisodeScheduleAction(null, formData);

    expect(result).toEqual({
      message: "テナント ID が見つかりません。",
      mode: "schedule",
      ok: false,
    });
    expect(mockUpdateEpisodePublishSchedule).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("公開スケジュール更新: publish_at が不正形式ならエラーを返す", async () => {
    const { updateEpisodeScheduleAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("series_public_id", "SERIES001");
    formData.set("episode_public_id", "EP001");
    formData.set("publish_at", "not-a-date");

    const result = await updateEpisodeScheduleAction(null, formData);

    expect(result).toEqual({
      message: "publish_at の形式が正しくありません。",
      mode: "schedule",
      ok: false,
    });
    expect(mockUpdateEpisodePublishSchedule).not.toHaveBeenCalled();
  });

  it("公開スケジュール更新: 成功時は API 呼び出し後にリダイレクトする", async () => {
    mockUpdateEpisodePublishSchedule.mockResolvedValueOnce({ ok: true });

    const { updateEpisodeScheduleAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("series_public_id", "SERIES001");
    formData.set("episode_public_id", "EP001");
    formData.set("publish_at", "2099-06-01T10:00:00Z");

    await updateEpisodeScheduleAction(null, formData);

    expect(mockUpdateEpisodePublishSchedule).toHaveBeenCalledWith({
      episodePublicId: "EP001",
      publishAt: "2099-06-01T10:00:00Z",
      tenantId: "TENANT001",
    });
    expect(mockRedirect).toHaveBeenCalledWith(
      "/series/SERIES001/episodes/EP001?schedule_updated=1"
    );
  });

  it("公開スケジュール更新: datetime-local の壁時計はテナントタイムゾーンとして解釈する", async () => {
    mockGetTenantDisplayTimeZone.mockResolvedValue("America/Los_Angeles");
    mockUpdateEpisodePublishSchedule.mockResolvedValueOnce({ ok: true });

    const { updateEpisodeScheduleAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("series_public_id", "SERIES001");
    formData.set("episode_public_id", "EP001");
    // Zone-less wall clock, as posted by <input type="datetime-local">.
    formData.set("publish_at", "2099-06-01T10:00");

    await updateEpisodeScheduleAction(null, formData);

    // PDT (UTC-7) in June — 10:00 in Los Angeles is 17:00Z.
    expect(mockUpdateEpisodePublishSchedule).toHaveBeenCalledWith({
      episodePublicId: "EP001",
      publishAt: "2099-06-01T17:00:00Z",
      tenantId: "TENANT001",
    });
    expect(mockGetTenantDisplayTimeZone).toHaveBeenCalledWith("TENANT001");
  });

  it("公開スケジュール更新: 日付のみの publish_at は形式エラーにする", async () => {
    const { updateEpisodeScheduleAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("series_public_id", "SERIES001");
    formData.set("episode_public_id", "EP001");
    formData.set("publish_at", "2099-06-01");

    const result = await updateEpisodeScheduleAction(null, formData);

    expect(result).toEqual({
      message: "publish_at の形式が正しくありません。",
      mode: "schedule",
      ok: false,
    });
    expect(mockUpdateEpisodePublishSchedule).not.toHaveBeenCalled();
  });

  it("ページ入稿: pages モードでファイル未選択ならエラーを返す", async () => {
    const { uploadEpisodePagesAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("series_public_id", "SERIES001");
    formData.set("episode_public_id", "EP001");
    formData.set("upload_mode", "pages");

    const result = await uploadEpisodePagesAction(null, formData);

    expect(result).toEqual({
      message: "追加するページ画像を選択してください。",
      mode: "pages",
      ok: false,
    });
    expect(mockUploadEpisodePages).not.toHaveBeenCalled();
  });

  it("ページ入稿: zip モードで拡張子不正ならエラーを返す", async () => {
    const { uploadEpisodePagesAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("series_public_id", "SERIES001");
    formData.set("episode_public_id", "EP001");
    formData.set("upload_mode", "zip");
    formData.set(
      "archive",
      new File(["dummy"], "pages.txt", { type: "text/plain" })
    );

    const result = await uploadEpisodePagesAction(null, formData);

    expect(result).toEqual({
      message: "ZIP 形式（.zip）のファイルを選択してください。",
      mode: "pages",
      ok: false,
    });
    expect(mockUploadEpisodePages).not.toHaveBeenCalled();
  });

  it("ページ入稿: pages モード成功時は API 呼び出し後にリダイレクトする", async () => {
    mockUploadEpisodePages.mockResolvedValueOnce({ ok: true });

    const { uploadEpisodePagesAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("series_public_id", "SERIES001");
    formData.set("episode_public_id", "EP001");
    formData.set("upload_mode", "pages");
    formData.append("pages", new File(["a"], "1.png", { type: "image/png" }));
    formData.append("pages", new File(["b"], "2.png", { type: "image/png" }));

    await uploadEpisodePagesAction(null, formData);

    expect(mockUploadEpisodePages).toHaveBeenCalledWith({
      episodePublicId: "EP001",
      pages: expect.arrayContaining([
        expect.objectContaining({ name: "1.png" }),
        expect.objectContaining({ name: "2.png" }),
      ]),
      tenantId: "TENANT001",
    });
    expect(mockRedirect).toHaveBeenCalledWith(
      "/series/SERIES001/episodes/EP001?pages_uploaded=1"
    );
  });

  it("画像並び替え: 不正な ordered_image_ids ならエラーを返す", async () => {
    const { reorderEpisodeImagesAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("series_public_id", "SERIES001");
    formData.set("episode_public_id", "EP001");
    formData.set("ordered_image_ids", "not-json");

    const result = await reorderEpisodeImagesAction(formData);

    expect(result).toEqual({
      message: "並び替え対象の画像がありません。",
      ok: false,
    });
    expect(mockReorderEpisodeImages).not.toHaveBeenCalled();
  });

  it("画像並び替え: 成功時は reorder API の結果を反映する", async () => {
    mockReorderEpisodeImages.mockResolvedValueOnce({ ok: true });

    const { reorderEpisodeImagesAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("series_public_id", "SERIES001");
    formData.set("episode_public_id", "EP001");
    formData.set("ordered_image_ids", JSON.stringify(["IMG1", "IMG2"]));

    const result = await reorderEpisodeImagesAction(formData);

    expect(mockReorderEpisodeImages).toHaveBeenCalledWith({
      episodePublicId: "EP001",
      imageIds: ["IMG1", "IMG2"],
      tenantId: "TENANT001",
    });
    expect(result).toEqual({ ok: true });
  });
});
