import { describe, expect, it, vi } from "vitest";

import { createTenantHeaderInterceptor } from "./tenant-header";

describe("createTenantHeaderInterceptor", () => {
  it("fills in tenantId from the message when the request header is unset", async () => {
    const interceptor = createTenantHeaderInterceptor({});
    const next = vi.fn(() => Promise.resolve({ ok: true }));
    const header = new Headers();

    await interceptor?.(next as never)({
      header,
      message: {
        tenant: { tenantId: "018f0e6a-1000-7000-8000-000000000001" },
      },
    } as never);

    expect(header.get("X-Publira-Tenant-Id")).toBe(
      "018f0e6a-1000-7000-8000-000000000001"
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it("an existing header is not overwritten", async () => {
    const interceptor = createTenantHeaderInterceptor({
      tenantId: "018f0e6a-1000-7000-8000-000000000002",
    });
    const next = vi.fn(() => Promise.resolve({ ok: true }));
    const header = new Headers();
    header.set("X-Publira-Tenant-Id", "018f0e6a-1000-7000-8000-000000000001");

    await interceptor?.(next as never)({
      header,
      message: {
        tenant: { tenantId: "018f0e6a-1000-7000-8000-000000000003" },
      },
    } as never);

    expect(header.get("X-Publira-Tenant-Id")).toBe(
      "018f0e6a-1000-7000-8000-000000000001"
    );
  });

  it("options.tenantId takes precedence over the message", async () => {
    const interceptor = createTenantHeaderInterceptor({
      tenantId: () => "018f0e6a-1000-7000-8000-000000000099",
    });
    const next = vi.fn(() => Promise.resolve({ ok: true }));
    const header = new Headers();

    await interceptor?.(next as never)({
      header,
      message: {
        tenant: { tenantId: "018f0e6a-1000-7000-8000-000000000001" },
      },
    } as never);

    expect(header.get("X-Publira-Tenant-Id")).toBe(
      "018f0e6a-1000-7000-8000-000000000099"
    );
  });
});
