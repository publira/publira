import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetSessionId, mockGetTenant } = vi.hoisted(() => ({
  mockGetSessionId: vi.fn(),
  mockGetTenant: vi.fn(),
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
  });

  it("does not ask for a fresh login when the tenant is not visible", async () => {
    mockGetTenant.mockRejectedValueOnce(
      new ConnectError("tenant not found", Code.NotFound)
    );

    const { getTenantForSession } = await import("./tenant-detail");

    await expect(getTenantForSession("tenant_admin_001")).resolves.toEqual({
      ok: false,
      requiresSignIn: false,
    });
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
