import { describe, expect, it, vi } from "vitest";

import { createTenantPublicIdResolver } from "./tenant-resolution";

describe("createTenantPublicIdResolver", () => {
  it("候補が空なら API を呼ばず null を返す", async () => {
    const getTenantByDomain = vi.fn();
    const resolver = createTenantPublicIdResolver(
      { domain: { getTenantByDomain } } as never,
      { max: 10, ttl: 1000 }
    );

    await expect(resolver([])).resolves.toBeNull();
    expect(getTenantByDomain).not.toHaveBeenCalled();
  });

  it("解決結果をキャッシュし同一キーの2回目呼び出しで再取得しない", async () => {
    const getTenantByDomain = vi
      .fn()
      .mockResolvedValue({ tenantPublicId: " TENANT001 " });
    const resolver = createTenantPublicIdResolver(
      { domain: { getTenantByDomain } } as never,
      { max: 10, ttl: 10_000 }
    );

    await expect(resolver(["a.example.com", "example.com"])).resolves.toBe(
      "TENANT001"
    );
    await expect(resolver(["a.example.com", "example.com"])).resolves.toBe(
      "TENANT001"
    );

    expect(getTenantByDomain).toHaveBeenCalledOnce();
  });

  it("not found エラーは null としてキャッシュする", async () => {
    const getTenantByDomain = vi.fn().mockRejectedValue({ code: 5 });
    const resolver = createTenantPublicIdResolver(
      { domain: { getTenantByDomain } } as never,
      { max: 10, ttl: 10_000 }
    );

    await expect(resolver(["unknown.example.com"])).resolves.toBeNull();
    await expect(resolver(["unknown.example.com"])).resolves.toBeNull();

    expect(getTenantByDomain).toHaveBeenCalledOnce();
  });
});
