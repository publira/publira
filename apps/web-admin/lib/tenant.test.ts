import {
  Code,
  ConnectError,
  ErrorInfoSchema,
} from "@publira/api-client/errors";
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
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();

    const { clearTenantRoutingCache } = await import("./tenant");

    clearTenantRoutingCache();
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

  it("answers a suspended tenant without remembering it, so a resume opens the console at once", async () => {
    mockGetTenantByDomain
      .mockRejectedValueOnce(
        new ConnectError(
          "tenant is suspended",
          Code.FailedPrecondition,
          undefined,
          [
            {
              desc: ErrorInfoSchema,
              value: { domain: "publira", reason: "TENANT_SUSPENDED" },
            },
          ]
        )
      )
      .mockResolvedValueOnce({
        defaultLocale: "en",
        tenantId: "018f0e6a-1000-7000-8000-000000000001",
      });

    const { resolveTenantRouting, SUSPENDED_TENANT } = await import("./tenant");

    await expect(resolveTenantRouting(["admin.paused.example"])).resolves.toBe(
      SUSPENDED_TENANT
    );
    await expect(
      resolveTenantRouting(["admin.paused.example"])
    ).resolves.toEqual({
      defaultLocale: "en",
      tenantId: "018f0e6a-1000-7000-8000-000000000001",
    });
    expect(mockGetTenantByDomain).toHaveBeenCalledTimes(2);
  });

  it("rethrows an unexpected error", async () => {
    mockGetTenantByDomain.mockRejectedValueOnce(new Error("db timeout"));

    const { resolveTenantRouting } = await import("./tenant");

    await expect(resolveTenantRouting(["admin.example.com"])).rejects.toThrow(
      "db timeout"
    );
  });

  it("drops one tenant's cached routing so the next request reads the new default", async () => {
    const saved = "018f0e6a-1000-7000-8000-000000000001";
    const other = "018f0e6a-1000-7000-8000-000000000002";

    mockGetTenantByDomain
      .mockResolvedValueOnce({ defaultLocale: "en", tenantId: saved })
      .mockResolvedValueOnce({ defaultLocale: "ja", tenantId: other })
      .mockResolvedValueOnce({ defaultLocale: "ja", tenantId: saved });

    const { forgetTenantRouting, resolveTenantRouting } =
      await import("./tenant");

    await expect(
      resolveTenantRouting(["admin.saved.example"])
    ).resolves.toMatchObject({ defaultLocale: "en", tenantId: saved });
    await expect(
      resolveTenantRouting(["admin.other.example"])
    ).resolves.toMatchObject({ defaultLocale: "ja", tenantId: other });

    // The first answer is what a later request would keep for the TTL.
    await expect(
      resolveTenantRouting(["admin.saved.example"])
    ).resolves.toMatchObject({ defaultLocale: "en" });
    expect(mockGetTenantByDomain).toHaveBeenCalledTimes(2);

    forgetTenantRouting(`  ${saved}  `);

    await expect(
      resolveTenantRouting(["admin.saved.example"])
    ).resolves.toMatchObject({ defaultLocale: "ja", tenantId: saved });
    await expect(
      resolveTenantRouting(["admin.other.example"])
    ).resolves.toMatchObject({ defaultLocale: "ja", tenantId: other });
    expect(mockGetTenantByDomain).toHaveBeenCalledTimes(3);
  });

  it("keeps one cache for every copy of this module in the process", async () => {
    const tenantId = "018f0e6a-1000-7000-8000-000000000001";

    mockGetTenantByDomain
      .mockResolvedValueOnce({ defaultLocale: "en", tenantId })
      .mockResolvedValueOnce({ defaultLocale: "ja", tenantId });

    const first = await import("./tenant");

    await expect(
      first.resolveTenantRouting(["admin.shared.example"])
    ).resolves.toMatchObject({ defaultLocale: "en", tenantId });

    vi.resetModules();

    const second = await import("./tenant");

    await expect(
      second.resolveTenantRouting(["admin.shared.example"])
    ).resolves.toMatchObject({ defaultLocale: "en", tenantId });
    expect(mockGetTenantByDomain).toHaveBeenCalledTimes(1);

    second.forgetTenantRouting(tenantId);
    vi.resetModules();

    const third = await import("./tenant");

    await expect(
      third.resolveTenantRouting(["admin.shared.example"])
    ).resolves.toMatchObject({ defaultLocale: "ja", tenantId });
    expect(mockGetTenantByDomain).toHaveBeenCalledTimes(2);
  });
});
