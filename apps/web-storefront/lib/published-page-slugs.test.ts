import type { PublicApiClient } from "@publira/api-client/public/client";
import { describe, expect, it, vi } from "vitest";

import { createPublishedPageSlugResolver } from "./published-page-slugs";

vi.mock("@publira/next-cache-handlers/tags", () => ({
  readTagRevalidatedAt: vi.fn(),
}));

const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** `revalidatedAt` answering `null` stands for a Redis that cannot be read. */
const setup = (options?: { revalidatedAt?: () => number | null }) => {
  let clock = 1000;
  const listPublishedPageSlugs = vi.fn(() =>
    Promise.resolve({ slugs: ["/privacy"] })
  );
  const readRevalidatedAt = vi.fn((_tag: string) => {
    const value = options?.revalidatedAt ? options.revalidatedAt() : 0;
    return Promise.resolve(value ?? undefined);
  });
  const resolve = createPublishedPageSlugResolver(
    { pages: { listPublishedPageSlugs } } as unknown as PublicApiClient,
    { now: () => clock, readRevalidatedAt }
  );
  return {
    advance: (ms: number) => {
      clock += ms;
    },
    listPublishedPageSlugs,
    now: () => clock,
    readRevalidatedAt,
    resolve,
  };
};

describe("createPublishedPageSlugResolver", () => {
  it("reads a tenant's slugs once and serves them from memory", async () => {
    const { listPublishedPageSlugs, readRevalidatedAt, resolve } = setup();

    expect(await resolve(TENANT_ID)).toEqual(new Set(["/privacy"]));
    expect(await resolve(TENANT_ID)).toEqual(new Set(["/privacy"]));

    expect(listPublishedPageSlugs).toHaveBeenCalledExactlyOnceWith({
      tenant: { tenantId: TENANT_ID },
    });
    expect(readRevalidatedAt).toHaveBeenCalledWith(`tenant:${TENANT_ID}:pages`);
  });

  it("reads the slugs again once the pages tag is revalidated", async () => {
    let revalidatedAt: number | null = 0;
    const { advance, listPublishedPageSlugs, now, resolve } = setup({
      revalidatedAt: () => revalidatedAt,
    });

    await resolve(TENANT_ID);
    advance(10);
    revalidatedAt = now();
    listPublishedPageSlugs.mockResolvedValueOnce({
      slugs: ["/privacy", "/series"],
    });
    advance(10);

    expect(await resolve(TENANT_ID)).toEqual(new Set(["/privacy", "/series"]));
    expect(listPublishedPageSlugs).toHaveBeenCalledTimes(2);
  });

  it("keeps serving what it holds when Redis cannot be read", async () => {
    const { listPublishedPageSlugs, resolve } = setup({
      revalidatedAt: () => null,
    });

    await resolve(TENANT_ID);
    await resolve(TENANT_ID);

    expect(listPublishedPageSlugs).toHaveBeenCalledOnce();
  });

  it("shares one read between concurrent requests", async () => {
    const { listPublishedPageSlugs, resolve } = setup();

    await Promise.all([resolve(TENANT_ID), resolve(TENANT_ID)]);

    expect(listPublishedPageSlugs).toHaveBeenCalledOnce();
  });

  it("resolves to null instead of throwing when the API fails", async () => {
    const { listPublishedPageSlugs, resolve } = setup();
    listPublishedPageSlugs.mockRejectedValueOnce(new Error("unavailable"));

    expect(await resolve(TENANT_ID)).toBeNull();
  });

  it("keeps the slugs it held when a later read fails", async () => {
    let revalidatedAt: number | null = 0;
    const { advance, listPublishedPageSlugs, now, resolve } = setup({
      revalidatedAt: () => revalidatedAt,
    });

    await resolve(TENANT_ID);
    advance(10);
    revalidatedAt = now();
    listPublishedPageSlugs.mockRejectedValueOnce(new Error("unavailable"));

    expect(await resolve(TENANT_ID)).toEqual(new Set(["/privacy"]));
  });
});
