import {
  Code,
  ConnectError,
  ErrorInfoSchema,
} from "@publira/api-client/errors";
import { describe, expect, it, vi } from "vitest";

import { createTenantResolver, SUSPENDED_TENANT } from "./tenant-resolution";

vi.mock("@publira/next-cache-handlers/tags", () => ({
  readTagRevalidatedAt: vi.fn(() => Promise.resolve(0)),
}));

const TENANT_ID = "018f0e6a-1000-7000-8000-000000000001";

/**
 * A resolver on a clock the test moves, whose tag reads answer
 * `revalidatedAt()`; `undefined` stands for a Redis that cannot be read.
 */
const setupRevalidation = (revalidatedAt: () => number | undefined) => {
  let clock = 1000;
  const getTenantByDomain = vi.fn().mockResolvedValue({
    defaultLocale: "ja",
    supportedLocales: ["ja", "en", "ko"],
    tenantId: TENANT_ID,
  });
  const readRevalidatedAt = vi.fn((_tag: string) =>
    Promise.resolve(revalidatedAt())
  );
  const resolver = createTenantResolver(
    { domain: { getTenantByDomain } } as never,
    { max: 10, now: () => clock, readRevalidatedAt, ttl: 300_000 }
  );
  return {
    advance: (ms: number) => {
      clock += ms;
    },
    getTenantByDomain,
    now: () => clock,
    readRevalidatedAt,
    resolver,
  };
};

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
      supportedLocales: ["en"],
      tenantId: "018f0e6a-1000-7000-8000-000000000001",
    });
    const resolver = createTenantResolver(
      { domain: { getTenantByDomain } } as never,
      { max: 10, ttl: 10_000 }
    );

    await expect(resolver(["en.example.com"])).resolves.toEqual({
      defaultLocale: "en",
      supportedLocales: ["en"],
      tenantId: "018f0e6a-1000-7000-8000-000000000001",
    });
  });

  it("carries the locales the tenant offers in registry order, its default among them", async () => {
    const getTenantByDomain = vi.fn().mockResolvedValue({
      defaultLocale: "ko",
      supportedLocales: ["en", "ja"],
      tenantId: "018f0e6a-1000-7000-8000-000000000001",
    });
    const resolver = createTenantResolver(
      { domain: { getTenantByDomain } } as never,
      { max: 10, ttl: 10_000 }
    );

    await expect(resolver(["ko.example.com"])).resolves.toMatchObject({
      supportedLocales: ["ja", "en", "ko"],
    });
  });

  it("refuses an offered locale this build serves no catalog for", async () => {
    const getTenantByDomain = vi.fn().mockResolvedValue({
      defaultLocale: "en",
      supportedLocales: ["en", "fr"],
      tenantId: "018f0e6a-1000-7000-8000-000000000001",
    });
    const resolver = createTenantResolver(
      { domain: { getTenantByDomain } } as never,
      { max: 10, ttl: 10_000 }
    );

    await expect(resolver(["fr.example.com"])).rejects.toThrow(
      "tenant supported locale is not supported: fr"
    );
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
      supportedLocales: ["ja"],
      tenantId: "018f0e6a-1000-7000-8000-000000000001",
    });
    await expect(resolver(["a.example.com", "example.com"])).resolves.toEqual({
      defaultLocale: "ja",
      supportedLocales: ["ja"],
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
  it("answers a suspended tenant without remembering it, so a resume serves the site at once", async () => {
    const getTenantByDomain = vi
      .fn()
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
        tenantId: "tenant-1",
      });
    const resolver = createTenantResolver(
      { domain: { getTenantByDomain } } as never,
      { max: 10, ttl: 10_000 }
    );

    await expect(resolver(["paused.example.com"])).resolves.toBe(
      SUSPENDED_TENANT
    );
    await expect(resolver(["paused.example.com"])).resolves.toEqual({
      defaultLocale: "en",
      supportedLocales: ["en"],
      tenantId: "tenant-1",
    });

    expect(getTenantByDomain).toHaveBeenCalledTimes(2);
  });

  it("reads a held tenant again once its site tag is revalidated", async () => {
    let revalidatedAt: number | undefined = 0;
    const { advance, getTenantByDomain, now, readRevalidatedAt, resolver } =
      setupRevalidation(() => revalidatedAt);

    await resolver(["shop.example.com"]);
    advance(10);
    // The console saved the languages: Korean is switched off.
    revalidatedAt = now();
    getTenantByDomain.mockResolvedValueOnce({
      defaultLocale: "ja",
      supportedLocales: ["ja", "en"],
      tenantId: TENANT_ID,
    });
    advance(10);

    await expect(resolver(["shop.example.com"])).resolves.toMatchObject({
      supportedLocales: ["ja", "en"],
    });
    expect(getTenantByDomain).toHaveBeenCalledTimes(2);
    expect(readRevalidatedAt).toHaveBeenCalledWith(`tenant:${TENANT_ID}:site`);
  });

  it("keeps serving a held tenant when the read its moved tag asks for fails", async () => {
    let revalidatedAt: number | undefined = 0;
    const { advance, getTenantByDomain, now, resolver } = setupRevalidation(
      () => revalidatedAt
    );

    await resolver(["shop.example.com"]);
    advance(10);
    revalidatedAt = now();
    getTenantByDomain.mockRejectedValueOnce(
      new ConnectError("upstream unavailable", Code.Unavailable)
    );
    advance(10);

    await expect(resolver(["shop.example.com"])).resolves.toMatchObject({
      supportedLocales: ["ja", "en", "ko"],
      tenantId: TENANT_ID,
    });
    expect(getTenantByDomain).toHaveBeenCalledTimes(2);
  });

  it("answers a suspension even while a tenant is held", async () => {
    let revalidatedAt: number | undefined = 0;
    const { advance, getTenantByDomain, now, resolver } = setupRevalidation(
      () => revalidatedAt
    );

    await resolver(["shop.example.com"]);
    advance(10);
    revalidatedAt = now();
    getTenantByDomain.mockRejectedValueOnce(
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
    );
    advance(10);

    await expect(resolver(["shop.example.com"])).resolves.toBe(
      SUSPENDED_TENANT
    );
  });

  it("keeps a held tenant whose site tag has not moved since the lookup", async () => {
    const { getTenantByDomain, resolver } = setupRevalidation(() => 0);

    await resolver(["shop.example.com"]);
    await resolver(["shop.example.com"]);

    expect(getTenantByDomain).toHaveBeenCalledOnce();
  });

  it("keeps a held tenant when Redis cannot be read", async () => {
    const { getTenantByDomain, resolver } = setupRevalidation(() => {});

    await resolver(["shop.example.com"]);
    await resolver(["shop.example.com"]);

    expect(getTenantByDomain).toHaveBeenCalledOnce();
  });

  it("holds an unknown host without asking about any tag", async () => {
    const getTenantByDomain = vi
      .fn()
      .mockRejectedValue(new ConnectError("tenant not found", Code.NotFound));
    const readRevalidatedAt = vi.fn(() => Promise.resolve(Number.MAX_VALUE));
    const resolver = createTenantResolver(
      { domain: { getTenantByDomain } } as never,
      { max: 10, readRevalidatedAt, ttl: 10_000 }
    );

    await resolver(["unknown.example.com"]);
    await resolver(["unknown.example.com"]);

    expect(getTenantByDomain).toHaveBeenCalledOnce();
    expect(readRevalidatedAt).not.toHaveBeenCalled();
  });
});
