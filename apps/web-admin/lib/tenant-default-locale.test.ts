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

  it("returns the default locale of the tenant on a successful fetch", async () => {
    mockGetTenantDefaultLocaleApi.mockResolvedValueOnce({
      defaultLocale: "en",
    });

    const { getTenantDefaultLocale } = await import("./tenant-default-locale");

    const result = await getTenantDefaultLocale("TENANT001", "en");

    expect(result).toEqual({ defaultLocale: "en", ok: true });
    expect(mockGetTenantDefaultLocaleApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith(
      "tenant:TENANT001:default-locale"
    );
  });

  it("reports a missing session without naming a saved locale", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { getTenantDefaultLocale } = await import("./tenant-default-locale");

    const result = await getTenantDefaultLocale("TENANT001", "en");

    expect(result).toEqual({
      message: "Your session is no longer valid. Please sign in again.",
      ok: false,
      requiresSignIn: true,
    });
    expect(mockGetTenantDefaultLocaleApi).not.toHaveBeenCalled();
  });

  it("reports a failed read without naming a saved locale", async () => {
    mockGetTenantDefaultLocaleApi.mockRejectedValueOnce(
      new ConnectError("tenant unavailable", Code.Unavailable)
    );

    const { getTenantDefaultLocale } = await import("./tenant-default-locale");

    const result = await getTenantDefaultLocale("TENANT001", "en");

    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("defaultLocale");
  });

  it("returns the saved default locale on a successful update", async () => {
    mockUpdateTenantDefaultLocaleApi.mockResolvedValueOnce({
      defaultLocale: "en",
    });

    const { updateTenantDefaultLocale } =
      await import("./tenant-default-locale");

    const result = await updateTenantDefaultLocale(
      {
        defaultLocale: "en",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({ defaultLocale: "en", ok: true });
    expect(mockUpdateTenantDefaultLocaleApi).toHaveBeenCalledWith(
      { defaultLocale: "en", tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("returns the shared input error message for invalid_argument on an update", async () => {
    mockUpdateTenantDefaultLocaleApi.mockRejectedValueOnce(
      new ConnectError(
        "default_locale must be a supported locale",
        Code.InvalidArgument
      )
    );

    const { updateTenantDefaultLocale } =
      await import("./tenant-default-locale");

    const result = await updateTenantDefaultLocale(
      {
        defaultLocale: "en",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({
      message: "The submitted values are invalid.",
      ok: false,
    });
  });

  it("returns the shared permission error message without the permission", async () => {
    mockUpdateTenantDefaultLocaleApi.mockRejectedValueOnce(
      new ConnectError("admin role required", Code.PermissionDenied)
    );

    const { updateTenantDefaultLocale } =
      await import("./tenant-default-locale");

    const result = await updateTenantDefaultLocale(
      {
        defaultLocale: "en",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result.ok).toBe(false);
  });

  it("tenantDefaultLocaleCacheTag normalizes the tenant id", async () => {
    const { tenantDefaultLocaleCacheTag } =
      await import("./tenant-default-locale");

    expect(tenantDefaultLocaleCacheTag("  TENANT001 ")).toBe(
      "tenant:TENANT001:default-locale"
    );
  });

  it("treats a code this build does not serve as a failed read", async () => {
    mockGetTenantDefaultLocaleApi.mockResolvedValueOnce({
      defaultLocale: "fr",
    });

    const { getTenantDefaultLocale } = await import("./tenant-default-locale");

    const result = await getTenantDefaultLocale("TENANT001", "en");

    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("defaultLocale");
  });
});
