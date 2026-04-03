import { describe, expect, it, vi } from "vitest";

import { createTenantHeaderInterceptor } from "./tenant-header";

describe("createTenantHeaderInterceptor", () => {
  it("リクエストヘッダー未設定時は message から tenantPublicId を補完する", async () => {
    const interceptor = createTenantHeaderInterceptor({});
    const next = vi.fn(() => Promise.resolve({ ok: true }));
    const header = new Headers();

    await interceptor?.(next as never)({
      header,
      message: { tenant: { tenantPublicId: "TENANT001" } },
    } as never);

    expect(header.get("X-Publira-Tenant-Public-Id")).toBe("TENANT001");
    expect(next).toHaveBeenCalledOnce();
  });

  it("既存ヘッダーがある場合は上書きしない", async () => {
    const interceptor = createTenantHeaderInterceptor({
      tenantPublicId: "TENANT_NEW",
    });
    const next = vi.fn(() => Promise.resolve({ ok: true }));
    const header = new Headers();
    header.set("X-Publira-Tenant-Public-Id", "TENANT_OLD");

    await interceptor?.(next as never)({
      header,
      message: { tenant: { tenantPublicId: "TENANT001" } },
    } as never);

    expect(header.get("X-Publira-Tenant-Public-Id")).toBe("TENANT_OLD");
  });

  it("options.tenantPublicId があれば message より優先する", async () => {
    const interceptor = createTenantHeaderInterceptor({
      tenantPublicId: () => "TENANT_FROM_OPTION",
    });
    const next = vi.fn(() => Promise.resolve({ ok: true }));
    const header = new Headers();

    await interceptor?.(next as never)({
      header,
      message: { tenant: { tenantPublicId: "TENANT_FROM_MESSAGE" } },
    } as never);

    expect(header.get("X-Publira-Tenant-Public-Id")).toBe("TENANT_FROM_OPTION");
  });
});
