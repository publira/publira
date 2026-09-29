import { AgeVerification } from "@publira/api-client/admin/types";
import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheLife,
  mockCacheTag,
  mockGetAccessToken,
  mockGetTenantAgeVerificationApi,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetTenantAgeVerificationApi: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    tenantSettings: {
      getTenantAgeVerification: mockGetTenantAgeVerificationApi,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

describe("tenant-age-verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("returns the saved rule of the tenant on a successful fetch", async () => {
    mockGetTenantAgeVerificationApi.mockResolvedValueOnce({
      ageVerification: AgeVerification.R18,
    });

    const { getTenantAgeVerification } =
      await import("./tenant-age-verification");

    const result = await getTenantAgeVerification("TENANT001", "en");

    expect(result).toEqual({ ageVerification: "r18", ok: true });
    expect(mockGetTenantAgeVerificationApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith(
      "tenant:TENANT001:age-verification"
    );
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it("reports a missing session and drops the cache entry", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { getTenantAgeVerification } =
      await import("./tenant-age-verification");

    const result = await getTenantAgeVerification("TENANT001", "en");

    expect(result).toEqual({
      message: "Your session is no longer valid. Please sign in again.",
      ok: false,
      requiresSignIn: true,
    });
    expect(mockGetTenantAgeVerificationApi).not.toHaveBeenCalled();
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("treats an unspecified rule as a failed read and drops the cache entry", async () => {
    mockGetTenantAgeVerificationApi.mockResolvedValueOnce({
      ageVerification: AgeVerification.UNSPECIFIED,
    });

    const { getTenantAgeVerification } =
      await import("./tenant-age-verification");

    const result = await getTenantAgeVerification("TENANT001", "en");

    expect(result).toEqual({
      message: "Could not load the age verification. Please try again later.",
      ok: false,
      requiresSignIn: false,
    });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("reports a failed read without naming a saved rule and drops the cache entry", async () => {
    mockGetTenantAgeVerificationApi.mockRejectedValueOnce(
      new ConnectError("tenant unavailable", Code.Unavailable)
    );

    const { getTenantAgeVerification } =
      await import("./tenant-age-verification");

    const result = await getTenantAgeVerification("TENANT001", "en");

    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("ageVerification");
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });
});
