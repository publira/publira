import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockRegisterWebPushDevice,
  mockRequirePublicSession,
  mockUnregisterWebPushDevice,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockRegisterWebPushDevice: vi.fn(),
  mockRequirePublicSession: vi.fn(),
  mockUnregisterWebPushDevice: vi.fn(),
}));

vi.mock("./push", () => ({
  registerWebPushDevice: mockRegisterWebPushDevice,
  unregisterWebPushDevice: mockUnregisterWebPushDevice,
}));

vi.mock("./auth-session", () => ({
  requirePublicSession: mockRequirePublicSession,
  withPublicSessionReauth: (
    _locale: string,
    _returnTo: string,
    run: () => Promise<unknown>
  ) => run(),
}));

vi.mock("./csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const endpoint = "https://push.test/subscriptions/abc";

const subscriptionInput = {
  auth: "auth-key",
  endpoint,
  locale: "en",
  p256dh: "p256dh-key",
  tenantId,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequirePublicSession.mockResolvedValue("session-token");
});

describe("registerBrowserPushAction", () => {
  it("passes the validated subscription on, without the tenant and locale in it", async () => {
    mockRegisterWebPushDevice.mockResolvedValue({ ok: true });

    const { registerBrowserPushAction } = await import("./push-actions");

    await expect(registerBrowserPushAction(subscriptionInput)).resolves.toEqual(
      { ok: true }
    );

    expect(mockAssertSameOrigin).toHaveBeenCalled();
    expect(mockRegisterWebPushDevice).toHaveBeenCalledWith({
      locale: "en",
      subscription: {
        auth: "auth-key",
        endpoint,
        p256dh: "p256dh-key",
      },
      tenantId,
    });
  });

  it.each([
    ["an endpoint that is not HTTPS", { endpoint: "http://push.test/abc" }],
    ["an endpoint that is not a URL", { endpoint: "push.test/abc" }],
    ["an empty key", { p256dh: "" }],
    ["a tenant id that is not one", { tenantId: "not-a-tenant" }],
  ])("refuses %s without reaching the API", async (_label, override) => {
    const { registerBrowserPushAction } = await import("./push-actions");

    const result = await registerBrowserPushAction({
      ...subscriptionInput,
      ...override,
    });

    expect(result.ok).toBe(false);
    expect(mockRegisterWebPushDevice).not.toHaveBeenCalled();
  });

  it("throws on a locale this site does not serve, having nothing to answer in", async () => {
    const { registerBrowserPushAction } = await import("./push-actions");

    await expect(
      registerBrowserPushAction({ ...subscriptionInput, locale: "de" })
    ).rejects.toThrow();
  });
});

describe("unregisterBrowserPushAction", () => {
  it("unregisters without requiring a session, so signing out is never stranded", async () => {
    mockUnregisterWebPushDevice.mockResolvedValue({ ok: true });

    const { unregisterBrowserPushAction } = await import("./push-actions");

    await expect(
      unregisterBrowserPushAction({ endpoint, locale: "en", tenantId })
    ).resolves.toEqual({ ok: true });

    expect(mockRequirePublicSession).not.toHaveBeenCalled();
    expect(mockUnregisterWebPushDevice).toHaveBeenCalledWith({
      endpoint,
      locale: "en",
      tenantId,
    });
  });

  it("refuses an endpoint no push service could have issued", async () => {
    const { unregisterBrowserPushAction } = await import("./push-actions");

    const result = await unregisterBrowserPushAction({
      endpoint: "ftp://push.test/abc",
      locale: "en",
      tenantId,
    });

    expect(result.ok).toBe(false);
    expect(mockUnregisterWebPushDevice).not.toHaveBeenCalled();
  });
});
