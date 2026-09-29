import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCacheLife, mockCacheTag, mockGetAccessToken, mockGetMfaStatus } =
  vi.hoisted(() => ({
    mockCacheLife: vi.fn(),
    mockCacheTag: vi.fn(),
    mockGetAccessToken: vi.fn(),
    mockGetMfaStatus: vi.fn(),
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
    auth: {
      getMfaStatus: mockGetMfaStatus,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

describe("getAdminMfaStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("returns the MFA status of the signed-in administrator", async () => {
    mockGetMfaStatus.mockResolvedValueOnce({
      enabled: true,
      remainingRecoveryCodes: 8,
      required: false,
    });

    const { getAdminMfaStatus } = await import("./admin-mfa");
    const result = await getAdminMfaStatus("TENANT001");

    expect(result).toEqual({
      ok: true,
      status: { enabled: true, remainingRecoveryCodes: 8, required: false },
    });
    expect(mockGetMfaStatus).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith(
      "tenant:TENANT001:admin-mfa-status"
    );
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it("asks for a fresh login and drops the cache entry when there is no session", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { getAdminMfaStatus } = await import("./admin-mfa");
    const result = await getAdminMfaStatus("TENANT001");

    expect(result).toEqual({ ok: false, requiresSignIn: true });
    expect(mockGetMfaStatus).not.toHaveBeenCalled();
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("asks for a fresh login and drops the cache entry when the session is rejected", async () => {
    mockGetMfaStatus.mockRejectedValueOnce(
      new ConnectError("invalid token", Code.Unauthenticated)
    );

    const { getAdminMfaStatus } = await import("./admin-mfa");
    const result = await getAdminMfaStatus("TENANT001");

    expect(result).toEqual({ ok: false, requiresSignIn: true });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("rethrows any other error", async () => {
    mockGetMfaStatus.mockRejectedValueOnce(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { getAdminMfaStatus } = await import("./admin-mfa");

    await expect(getAdminMfaStatus("TENANT001")).rejects.toThrow(
      "upstream down"
    );
  });
});
