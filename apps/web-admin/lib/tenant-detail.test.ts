import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCacheLife, mockGetSessionId, mockGetTenant } = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockGetSessionId: vi.fn(),
  mockGetTenant: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetSessionId,
}));

vi.mock("@publira/api-client/admin/client", () => ({
  createAdminApiClient: () => ({
    auth: {
      getMe: vi.fn(),
      getTenant: mockGetTenant,
    },
  }),
}));

describe("tenant-detail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetSessionId.mockResolvedValue("session-token");
  });

  it("fetches the tenant detail from the tenantId and the sessionId", async () => {
    mockGetTenant.mockResolvedValueOnce({
      tenant: {
        adminDomain: "admin.example.com",
        domain: "example.com",
        name: "Acme Publishing",
        publicId: "tenant_admin_001",
      },
    });

    const { getTenantForSession } = await import("./tenant-detail");

    await expect(getTenantForSession("tenant_admin_001")).resolves.toEqual({
      ok: true,
      tenant: {
        adminDomain: "admin.example.com",
        domain: "example.com",
        name: "Acme Publishing",
        publicId: "tenant_admin_001",
      },
    });

    expect(mockGetTenant).toHaveBeenCalledWith(
      {
        tenant: { tenantId: "tenant_admin_001" },
      },
      {
        headers: { Authorization: "Bearer session-token" },
      }
    );
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it("fails without asking for a fresh login when the tenant name is empty", async () => {
    mockGetTenant.mockResolvedValueOnce({
      tenant: {
        domain: "example.com",
        name: "",
        publicId: "tenant_admin_001",
      },
    });

    const { getTenantForSession } = await import("./tenant-detail");

    await expect(getTenantForSession("tenant_admin_001")).resolves.toEqual({
      ok: false,
      requiresSignIn: false,
    });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("asks for a fresh login without calling the API when there is no session", async () => {
    mockGetSessionId.mockResolvedValue("");

    const { getTenantForSession } = await import("./tenant-detail");

    await expect(getTenantForSession("tenant_admin_001")).resolves.toEqual({
      ok: false,
      requiresSignIn: true,
    });
    expect(mockGetTenant).not.toHaveBeenCalled();
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("asks for a fresh login when the session is rejected", async () => {
    mockGetTenant.mockRejectedValueOnce(
      new ConnectError("invalid session", Code.Unauthenticated)
    );

    const { getTenantForSession } = await import("./tenant-detail");

    await expect(getTenantForSession("tenant_admin_001")).resolves.toEqual({
      ok: false,
      requiresSignIn: true,
    });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("does not ask for a fresh login when the tenant is not visible, and keeps that answer cached", async () => {
    mockGetTenant.mockRejectedValueOnce(
      new ConnectError("tenant not found", Code.NotFound)
    );

    const { getTenantForSession } = await import("./tenant-detail");

    await expect(getTenantForSession("tenant_admin_001")).resolves.toEqual({
      ok: false,
      requiresSignIn: false,
    });
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it("throws an error it cannot classify as it is", async () => {
    mockGetTenant.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    const { getTenantForSession } = await import("./tenant-detail");

    await expect(getTenantForSession("tenant_admin_001")).rejects.toThrow(
      "boom"
    );
  });
});
