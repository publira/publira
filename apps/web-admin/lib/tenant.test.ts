import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetTenantByDomain } = vi.hoisted(() => ({
  mockGetTenantByDomain: vi.fn(),
}));

vi.mock("@publira/api-client/admin/client", () => ({
  createAdminApiClient: () => ({
    auth: {
      getTenantByDomain: mockGetTenantByDomain,
    },
  }),
}));

describe("tenant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("resolves the tenantId from the admin domain candidates", async () => {
    mockGetTenantByDomain.mockResolvedValueOnce({
      tenantId: "018f0e6a-1000-7000-8000-000000000001",
    });

    const { resolveTenantId } = await import("./tenant");

    await expect(resolveTenantId(["admin.example.com"])).resolves.toBe(
      "018f0e6a-1000-7000-8000-000000000001"
    );

    expect(mockGetTenantByDomain).toHaveBeenCalledWith({
      domains: ["admin.example.com"],
    });
  });

  it("returns null for an unregistered domain", async () => {
    mockGetTenantByDomain.mockRejectedValueOnce(
      new ConnectError("tenant not found", Code.NotFound)
    );

    const { resolveTenantId } = await import("./tenant");

    await expect(
      resolveTenantId(["admin.unknown.example"])
    ).resolves.toBeNull();
  });

  it("rethrows an unexpected error", async () => {
    mockGetTenantByDomain.mockRejectedValueOnce(new Error("db timeout"));

    const { resolveTenantId } = await import("./tenant");

    await expect(resolveTenantId(["admin.example.com"])).rejects.toThrow(
      "db timeout"
    );
  });
});
