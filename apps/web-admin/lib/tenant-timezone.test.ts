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

  it("returns the time zone of the tenant on a successful fetch", async () => {
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

  it("returns the default time zone and an error when there is no session", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { getTenantTimezone } = await import("./tenant-timezone");

    const result = await getTenantTimezone("TENANT001");

    expect(result).toEqual({
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
      requiresSignIn: true,
      timezone: "Asia/Tokyo",
    });
    expect(mockGetTenantTimezoneApi).not.toHaveBeenCalled();
  });

  it("returns the default alongside the failure so the form stays usable", async () => {
    mockGetTenantTimezoneApi.mockRejectedValueOnce(
      new ConnectError("tenant unavailable", Code.Unavailable)
    );

    const { getTenantTimezone } = await import("./tenant-timezone");

    const result = await getTenantTimezone("TENANT001");

    expect(result.ok).toBe(false);
    expect(result.timezone).toBe("Asia/Tokyo");
  });

  it("returns the saved time zone on a successful update", async () => {
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

  it("returns the message of the server as it is for invalid_argument on an update", async () => {
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

  it("returns the shared permission error message without the permission", async () => {
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

  it("tenantTimezoneCacheTag normalizes the tenant id", async () => {
    const { tenantTimezoneCacheTag } = await import("./tenant-timezone");

    expect(tenantTimezoneCacheTag("  TENANT001 ")).toBe(
      "tenant:TENANT001:timezone"
    );
  });

  it("returns the time zone of the tenant as the display time zone", async () => {
    mockGetTenantTimezoneApi.mockResolvedValueOnce({
      timezone: "America/Los_Angeles",
    });

    const { getTenantDisplayTimeZone } = await import("./tenant-timezone");

    await expect(getTenantDisplayTimeZone("TENANT001")).resolves.toBe(
      "America/Los_Angeles"
    );
  });

  it("still renders in the default time zone when the tenant cannot be fetched", async () => {
    // Degrading to the host's zone would make the rendered wall clock depend on
    // where the container runs, which is the thing #564 removed.
    mockGetTenantTimezoneApi.mockRejectedValueOnce(
      new ConnectError("tenant unavailable", Code.Unavailable)
    );

    const { getTenantDisplayTimeZone } = await import("./tenant-timezone");

    await expect(getTenantDisplayTimeZone("TENANT001")).resolves.toBe(
      "Asia/Tokyo"
    );
  });

  it("still renders in the default time zone when the tenant id is empty", async () => {
    const { getTenantDisplayTimeZone } = await import("./tenant-timezone");

    await expect(getTenantDisplayTimeZone("  ")).resolves.toBe("Asia/Tokyo");
    expect(mockGetTenantTimezoneApi).not.toHaveBeenCalled();
  });
});
