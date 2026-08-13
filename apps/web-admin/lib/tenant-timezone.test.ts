import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheTag,
  mockGetAccessToken,
  mockGetTenantTimezoneApi,
  mockUpdateTenantTimezoneApi,
} = vi.hoisted(() => ({
  mockCacheTag: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetTenantTimezoneApi: vi.fn(),
  mockUpdateTenantTimezoneApi: vi.fn(),
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
      getTenantTimezone: mockGetTenantTimezoneApi,
      updateTenantTimezone: mockUpdateTenantTimezoneApi,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

describe("tenant-timezone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("取得に成功した場合はテナントのタイムゾーンを返す", async () => {
    mockGetTenantTimezoneApi.mockResolvedValueOnce({
      timezone: "America/Los_Angeles",
    });

    const { getTenantTimezone } = await import("./tenant-timezone");

    const result = await getTenantTimezone("TENANT001");

    expect(result).toEqual({ ok: true, timezone: "America/Los_Angeles" });
    expect(mockGetTenantTimezoneApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith("tenant:TENANT001:timezone");
  });

  it("セッションがない場合はデフォルトのタイムゾーンとエラーを返す", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { getTenantTimezone } = await import("./tenant-timezone");

    const result = await getTenantTimezone("TENANT001");

    expect(result).toEqual({
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
      timezone: "Asia/Tokyo",
    });
    expect(mockGetTenantTimezoneApi).not.toHaveBeenCalled();
  });

  it("取得に失敗した場合もフォームが使えるようデフォルトを添えて返す", async () => {
    mockGetTenantTimezoneApi.mockRejectedValueOnce(
      new ConnectError("tenant unavailable", Code.Unavailable)
    );

    const { getTenantTimezone } = await import("./tenant-timezone");

    const result = await getTenantTimezone("TENANT001");

    expect(result.ok).toBe(false);
    expect(result.timezone).toBe("Asia/Tokyo");
  });

  it("更新に成功した場合は保存されたタイムゾーンを返す", async () => {
    mockUpdateTenantTimezoneApi.mockResolvedValueOnce({
      timezone: "Europe/Paris",
    });

    const { updateTenantTimezone } = await import("./tenant-timezone");

    const result = await updateTenantTimezone({
      tenantId: "TENANT001",
      timezone: "Europe/Paris",
    });

    expect(result).toEqual({ ok: true, timezone: "Europe/Paris" });
    expect(mockUpdateTenantTimezoneApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" }, timezone: "Europe/Paris" },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("更新時の invalid_argument はサーバのメッセージをそのまま返す", async () => {
    mockUpdateTenantTimezoneApi.mockRejectedValueOnce(
      new ConnectError(
        "timezone must be a valid IANA time zone name",
        Code.InvalidArgument
      )
    );

    const { updateTenantTimezone } = await import("./tenant-timezone");

    const result = await updateTenantTimezone({
      tenantId: "TENANT001",
      timezone: "Asia/Nowhere",
    });

    expect(result).toEqual({
      message: "timezone must be a valid IANA time zone name",
      ok: false,
    });
  });

  it("権限がない場合は共通の権限エラーメッセージを返す", async () => {
    mockUpdateTenantTimezoneApi.mockRejectedValueOnce(
      new ConnectError("admin role required", Code.PermissionDenied)
    );

    const { updateTenantTimezone } = await import("./tenant-timezone");

    const result = await updateTenantTimezone({
      tenantId: "TENANT001",
      timezone: "Europe/Paris",
    });

    expect(result.ok).toBe(false);
  });

  it("tenantTimezoneCacheTag はテナント ID を正規化する", async () => {
    const { tenantTimezoneCacheTag } = await import("./tenant-timezone");

    expect(tenantTimezoneCacheTag("  TENANT001 ")).toBe(
      "tenant:TENANT001:timezone"
    );
  });
});
