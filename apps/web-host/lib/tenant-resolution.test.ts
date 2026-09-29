import { Code, ConnectError } from "@publira/api-client/errors";
import { describe, expect, it, vi } from "vitest";

import { createTenantResolver } from "./tenant-resolution";

describe("createTenantResolver", () => {
  it("If the candidate is empty, do not call the API and return null", async () => {
    const getTenantByDomain = vi.fn();
    const resolver = createTenantResolver(
      { domain: { getTenantByDomain } } as never,
      { max: 10, ttl: 1000 }
    );

    await expect(resolver([])).resolves.toBeNull();
    expect(getTenantByDomain).not.toHaveBeenCalled();
  });

  it("Retrieve tenant default locale from same response", async () => {
    const getTenantByDomain = vi.fn().mockResolvedValue({
      defaultLocale: "en",
      tenantId: "018f0e6a-1000-7000-8000-000000000001",
    });
    const resolver = createTenantResolver(
      { domain: { getTenantByDomain } } as never,
      { max: 10, ttl: 10_000 }
    );

    await expect(resolver(["en.example.com"])).resolves.toEqual({
      defaultLocale: "en",
      tenantId: "018f0e6a-1000-7000-8000-000000000001",
    });
  });

  it("refuses a locale this build serves no catalog for", async () => {
    const getTenantByDomain = vi.fn().mockResolvedValue({
      defaultLocale: "fr",
      tenantId: "018f0e6a-1000-7000-8000-000000000001",
    });
    const resolver = createTenantResolver(
      { domain: { getTenantByDomain } } as never,
      { max: 10, ttl: 10_000 }
    );

    await expect(resolver(["fr.example.com"])).rejects.toThrow(
      "tenant default locale is not supported: fr"
    );
  });

  it("Cache the resolution result and do not retrieve it again on the second call with the same key", async () => {
    const getTenantByDomain = vi.fn().mockResolvedValue({
      defaultLocale: "ja",
      tenantId: " 018f0e6a-1000-7000-8000-000000000001 ",
    });
    const resolver = createTenantResolver(
      { domain: { getTenantByDomain } } as never,
      { max: 10, ttl: 10_000 }
    );

    await expect(resolver(["a.example.com", "example.com"])).resolves.toEqual({
      defaultLocale: "ja",
      tenantId: "018f0e6a-1000-7000-8000-000000000001",
    });
    await expect(resolver(["a.example.com", "example.com"])).resolves.toEqual({
      defaultLocale: "ja",
      tenantId: "018f0e6a-1000-7000-8000-000000000001",
    });

    expect(getTenantByDomain).toHaveBeenCalledOnce();
  });

  it("Cache not_found errors as null", async () => {
    const getTenantByDomain = vi
      .fn()
      .mockRejectedValue(new ConnectError("tenant not found", Code.NotFound));
    const resolver = createTenantResolver(
      { domain: { getTenantByDomain } } as never,
      { max: 10, ttl: 10_000 }
    );

    await expect(resolver(["unknown.example.com"])).resolves.toBeNull();
    await expect(resolver(["unknown.example.com"])).resolves.toBeNull();

    expect(getTenantByDomain).toHaveBeenCalledOnce();
  });

  it("Propagate unclassifiable errors and do not cache nulls", async () => {
    const getTenantByDomain = vi
      .fn()
      .mockRejectedValue(new ConnectError("upstream down", Code.Unavailable));
    const resolver = createTenantResolver(
      { domain: { getTenantByDomain } } as never,
      { max: 10, ttl: 10_000 }
    );

    await expect(resolver(["flaky.example.com"])).rejects.toThrow(
      "upstream down"
    );
    await expect(resolver(["flaky.example.com"])).rejects.toThrow(
      "upstream down"
    );

    expect(getTenantByDomain).toHaveBeenCalledTimes(2);
  });
});
