import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheTag,
  mockGetAccessToken,
  mockGetTenantDefaultLocaleApi,
  mockUpdateTenantDefaultLocaleApi,
} = vi.hoisted(() => ({
  mockCacheTag: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetTenantDefaultLocaleApi: vi.fn(),
  mockUpdateTenantDefaultLocaleApi: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheTag: mockCacheTag,
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    tenantSettings: {
      getTenantDefaultLocale: mockGetTenantDefaultLocaleApi,
      updateTenantDefaultLocale: mockUpdateTenantDefaultLocaleApi,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

describe("tenant-default-locale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("取得に成功した場合はテナントの既定言語を返す", async () => {
    mockGetTenantDefaultLocaleApi.mockResolvedValueOnce({
      defaultLocale: "en",
    });

    const { getTenantDefaultLocale } = await import("./tenant-default-locale");

    const result = await getTenantDefaultLocale("TENANT001");

    expect(result).toEqual({ defaultLocale: "en", ok: true });
    expect(mockGetTenantDefaultLocaleApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith(
      "tenant:TENANT001:default-locale"
    );
  });

  it("セッションがない場合はデフォルトの言語とエラーを返す", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { getTenantDefaultLocale } = await import("./tenant-default-locale");

    const result = await getTenantDefaultLocale("TENANT001");

    expect(result).toEqual({
      defaultLocale: "ja",
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
      requiresSignIn: true,
    });
    expect(mockGetTenantDefaultLocaleApi).not.toHaveBeenCalled();
  });

  it("取得に失敗した場合はフォールバック言語を添えて返す", async () => {
    mockGetTenantDefaultLocaleApi.mockRejectedValueOnce(
      new ConnectError("tenant unavailable", Code.Unavailable)
    );

    const { getTenantDefaultLocale } = await import("./tenant-default-locale");

    const result = await getTenantDefaultLocale("TENANT001");

    expect(result.ok).toBe(false);
    expect(result.defaultLocale).toBe("ja");
  });

  it("更新に成功した場合は保存された既定言語を返す", async () => {
    mockUpdateTenantDefaultLocaleApi.mockResolvedValueOnce({
      defaultLocale: "en",
    });

    const { updateTenantDefaultLocale } =
      await import("./tenant-default-locale");

    const result = await updateTenantDefaultLocale({
      defaultLocale: "en",
      tenantId: "TENANT001",
    });

    expect(result).toEqual({ defaultLocale: "en", ok: true });
    expect(mockUpdateTenantDefaultLocaleApi).toHaveBeenCalledWith(
      { defaultLocale: "en", tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("更新時の invalid_argument はサーバのメッセージをそのまま返す", async () => {
    mockUpdateTenantDefaultLocaleApi.mockRejectedValueOnce(
      new ConnectError(
        "default_locale must be a supported locale",
        Code.InvalidArgument
      )
    );

    const { updateTenantDefaultLocale } =
      await import("./tenant-default-locale");

    const result = await updateTenantDefaultLocale({
      defaultLocale: "en",
      tenantId: "TENANT001",
    });

    expect(result).toEqual({
      message: "default_locale must be a supported locale",
      ok: false,
    });
  });

  it("権限がない場合は共通の権限エラーメッセージを返す", async () => {
    mockUpdateTenantDefaultLocaleApi.mockRejectedValueOnce(
      new ConnectError("admin role required", Code.PermissionDenied)
    );

    const { updateTenantDefaultLocale } =
      await import("./tenant-default-locale");

    const result = await updateTenantDefaultLocale({
      defaultLocale: "en",
      tenantId: "TENANT001",
    });

    expect(result.ok).toBe(false);
  });

  it("tenantDefaultLocaleCacheTag はテナント ID を正規化する", async () => {
    const { tenantDefaultLocaleCacheTag } =
      await import("./tenant-default-locale");

    expect(tenantDefaultLocaleCacheTag("  TENANT001 ")).toBe(
      "tenant:TENANT001:default-locale"
    );
  });

  it("表示言語としてテナントの既定言語を返す", async () => {
    mockGetTenantDefaultLocaleApi.mockResolvedValueOnce({
      defaultLocale: "en",
    });

    const { getTenantDisplayLocale } = await import("./tenant-default-locale");

    await expect(getTenantDisplayLocale("TENANT001")).resolves.toBe("en");
  });

  it("テナントを取得できないときも既定言語で表示する", async () => {
    mockGetTenantDefaultLocaleApi.mockRejectedValueOnce(
      new ConnectError("tenant unavailable", Code.Unavailable)
    );

    const { getTenantDisplayLocale } = await import("./tenant-default-locale");

    await expect(getTenantDisplayLocale("TENANT001")).resolves.toBe("ja");
  });

  it("テナント ID が空のときも既定言語で表示する", async () => {
    const { getTenantDisplayLocale } = await import("./tenant-default-locale");

    await expect(getTenantDisplayLocale("  ")).resolves.toBe("ja");
    expect(mockGetTenantDefaultLocaleApi).not.toHaveBeenCalled();
  });

  it("未知のコードは既定言語に正規化する", async () => {
    mockGetTenantDefaultLocaleApi.mockResolvedValueOnce({
      defaultLocale: "fr",
    });

    const { getTenantDefaultLocale } = await import("./tenant-default-locale");

    const result = await getTenantDefaultLocale("TENANT001");

    expect(result).toEqual({ defaultLocale: "ja", ok: true });
  });
});
