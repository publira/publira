import type { Interceptor, UnaryRequest } from "@connectrpc/connect";
import { describe, expect, it, vi } from "vitest";

import { createTenantHeaderInterceptor } from "./tenant-header";

interface RequestMessage {
  tenant?: { tenantId: string };
  tenantPublicId?: string;
}

/** Runs `interceptor` on a request with `header` and `message`, and returns the `next` it called. */
const run = async (
  interceptor: Interceptor | undefined,
  header: Headers,
  message: RequestMessage
) => {
  const next = vi.fn<Parameters<Interceptor>[0]>();
  // SAFETY: the interceptor reads only `header` and `message` from the request
  // and hands it to `next` as it is, which does not read it.
  await interceptor?.(next)({ header, message } as UnaryRequest);

  return next;
};

describe("createTenantHeaderInterceptor", () => {
  it("fills in tenantId from the message when the request header is unset", async () => {
    const interceptor = createTenantHeaderInterceptor({});
    const header = new Headers();

    const next = await run(interceptor, header, {
      tenant: { tenantId: "018f0e6a-1000-7000-8000-000000000001" },
    });

    expect(header.get("X-Publira-Tenant-Id")).toBe(
      "018f0e6a-1000-7000-8000-000000000001"
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it("does not fill the header from a message's tenant public ID", async () => {
    const interceptor = createTenantHeaderInterceptor({});
    const header = new Headers();

    const next = await run(interceptor, header, {
      tenantPublicId: "TENANT000001",
    });

    expect(header.get("X-Publira-Tenant-Id")).toBeNull();
    expect(next).toHaveBeenCalledOnce();
  });

  it("an existing header is not overwritten", async () => {
    const interceptor = createTenantHeaderInterceptor({
      tenantId: "018f0e6a-1000-7000-8000-000000000002",
    });

    const header = new Headers();
    header.set("X-Publira-Tenant-Id", "018f0e6a-1000-7000-8000-000000000001");

    await run(interceptor, header, {
      tenant: { tenantId: "018f0e6a-1000-7000-8000-000000000003" },
    });

    expect(header.get("X-Publira-Tenant-Id")).toBe(
      "018f0e6a-1000-7000-8000-000000000001"
    );
  });

  it("options.tenantId takes precedence over the message", async () => {
    const interceptor = createTenantHeaderInterceptor({
      tenantId: () => "018f0e6a-1000-7000-8000-000000000099",
    });

    const header = new Headers();

    await run(interceptor, header, {
      tenant: { tenantId: "018f0e6a-1000-7000-8000-000000000001" },
    });

    expect(header.get("X-Publira-Tenant-Id")).toBe(
      "018f0e6a-1000-7000-8000-000000000099"
    );
  });
});
