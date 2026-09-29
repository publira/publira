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
      defaultLocale: "en",
      tenantId: "018f0e6a-1000-7000-8000-000000000001",
    });

    const { resolveTenantRouting } = await import("./tenant");

    await expect(
      resolveTenantRouting(["admin.example.com"])
    ).resolves.toMatchObject({
      tenantId: "018f0e6a-1000-7000-8000-000000000001",
    });

    expect(mockGetTenantByDomain).toHaveBeenCalledWith({
      domains: ["admin.example.com"],
    });
  });

  /**
   * The proxy publishes this value to the browser, so `<html lang>` and the
   * client error boundary name the language the tenant saved rather than the
   * one the visitor's browser asked for.
   */
  it("carries the tenant's saved default locale alongside the id", async () => {
    mockGetTenantByDomain.mockResolvedValueOnce({
      defaultLocale: "en",
      tenantId: "018f0e6a-1000-7000-8000-000000000001",
    });

    const { resolveTenantRouting } = await import("./tenant");

    await expect(
      resolveTenantRouting(["admin.example.com"])
    ).resolves.toMatchObject({ defaultLocale: "en" });
  });

  it("names no locale for a code this build serves no catalog for", async () => {
    mockGetTenantByDomain.mockResolvedValueOnce({
      defaultLocale: "fr",
      tenantId: "018f0e6a-1000-7000-8000-000000000001",
    });

    const { resolveTenantRouting } = await import("./tenant");

    await expect(
      resolveTenantRouting(["admin.example.com"])
    ).resolves.toMatchObject({
      defaultLocale: null,
      tenantId: "018f0e6a-1000-7000-8000-000000000001",
    });
  });

  it("returns null for an unregistered domain", async () => {
    mockGetTenantByDomain.mockRejectedValueOnce(
      new ConnectError("tenant not found", Code.NotFound)
    );

    const { resolveTenantRouting } = await import("./tenant");

    await expect(
      resolveTenantRouting(["admin.unknown.example"])
    ).resolves.toEqual({ defaultLocale: null, tenantId: null });
  });

  it("rethrows an unexpected error", async () => {
    mockGetTenantByDomain.mockRejectedValueOnce(new Error("db timeout"));

    const { resolveTenantRouting } = await import("./tenant");

    await expect(resolveTenantRouting(["admin.example.com"])).rejects.toThrow(
      "db timeout"
    );
  });
});
