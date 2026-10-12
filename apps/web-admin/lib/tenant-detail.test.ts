import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCacheLife, mockCacheTag, mockGetSessionId, mockGetTenant } =
  vi.hoisted(() => ({
    mockCacheLife: vi.fn(),
    mockCacheTag: vi.fn(),
    mockGetSessionId: vi.fn(),
    mockGetTenant: vi.fn(),
  }));

vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
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

  it("files the tenant under the tenant detail tag", async () => {
    mockGetTenant.mockResolvedValueOnce({
      tenant: {
        adminDomain: "admin.example.com",
        domain: "example.com",
        name: "Acme Publishing",
        publicId: "tenant_admin_001",
      },
    });

    const { getTenantForSession, tenantDetailCacheTag } =
      await import("./tenant-detail");

    await getTenantForSession(" tenant_admin_001 ");

    expect(mockCacheTag).toHaveBeenCalledWith(
      tenantDetailCacheTag("tenant_admin_001")
    );
  });

  it("tenantDetailCacheTag normalizes the tenant id", async () => {
    const { tenantDetailCacheTag } = await import("./tenant-detail");

    expect(tenantDetailCacheTag("  tenant_admin_001 ")).toBe(
      "tenant:tenant_admin_001:detail"
    );
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

  // The cache fill itself must not throw, or the request fails before any
  // boundary can render; the exported read throws once outside the scope.
  it("throws an error it cannot classify only outside the cache scope", async () => {
    mockGetTenant.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    const { getTenantForSession } = await import("./tenant-detail");

    await expect(getTenantForSession("tenant_admin_001")).rejects.toThrow(
      "The tenant could not be read."
    );
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });
});
