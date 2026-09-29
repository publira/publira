import { Code, ConnectError } from "@publira/api-client/errors";
import { PushPlatform } from "@publira/api-client/public/notification";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { registerWebPushDevice, unregisterWebPushDevice } from "./push";

const { mockRegister, mockResolveAccessToken, mockUnregister } = vi.hoisted(
  () => ({
    mockRegister: vi.fn(),
    mockResolveAccessToken: vi.fn(),
    mockUnregister: vi.fn(),
  })
);

vi.mock("./api-client", () => ({
  apiClient: {
    notification: {
      registerPushDevice: mockRegister,
      unregisterPushDevice: mockUnregister,
    },
  },
  buildSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
  resolveAccessToken: mockResolveAccessToken,
}));

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const endpoint = "https://push.test/subscriptions/abc";
const subscription = { auth: "auth-key", endpoint, p256dh: "p256dh-key" };

beforeEach(() => {
  mockResolveAccessToken.mockResolvedValue("session-token");
});

describe("registerWebPushDevice", () => {
  it("registers the subscription as a web platform device", async () => {
    mockRegister.mockResolvedValue({ registered: true });

    await expect(
      registerWebPushDevice({ locale: "en", subscription, tenantId })
    ).resolves.toEqual({ ok: true });

    expect(mockRegister).toHaveBeenCalledWith(
      {
        auth: "auth-key",
        endpoint,
        p256dh: "p256dh-key",
        platform: PushPlatform.WEB,
        tenant: { tenantId },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("reports a deployment that publishes no VAPID key rather than throwing", async () => {
    mockRegister.mockRejectedValue(
      new ConnectError("web push is not configured", Code.FailedPrecondition)
    );

    const result = await registerWebPushDevice({
      locale: "en",
      subscription,
      tenantId,
    });

    expect(result.ok).toBe(false);
  });

  it("reports the missing session without calling the API", async () => {
    mockResolveAccessToken.mockResolvedValue(null);

    const result = await registerWebPushDevice({
      locale: "en",
      subscription,
      tenantId,
    });

    expect(result.ok).toBe(false);
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it("re-throws a rejected session so the caller can re-authenticate", async () => {
    mockRegister.mockRejectedValue(
      new ConnectError("session expired", Code.Unauthenticated)
    );

    await expect(
      registerWebPushDevice({ locale: "en", subscription, tenantId })
    ).rejects.toThrow(ConnectError);
  });

  it("re-throws an unclassifiable failure rather than wording it", async () => {
    mockRegister.mockRejectedValue(new ConnectError("boom", Code.Internal));

    await expect(
      registerWebPushDevice({ locale: "en", subscription, tenantId })
    ).rejects.toThrow(ConnectError);
  });
});

describe("unregisterWebPushDevice", () => {
  it("identifies the registration by its subscription endpoint", async () => {
    mockUnregister.mockResolvedValue({ unregistered: true });

    await expect(
      unregisterWebPushDevice({ endpoint, locale: "en", tenantId })
    ).resolves.toEqual({ ok: true });

    expect(mockUnregister).toHaveBeenCalledWith(
      { endpoint, tenant: { tenantId } },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("treats a registration the server no longer holds as taken off", async () => {
    // `UnregisterPushDevice` answers `unregistered: false` rather than failing
    // when the row was already gone — removing nothing is not an error. That is
    // what lets the browser give up its own subscription either way, instead of
    // being stuck subscribed to a registration nothing will ever deliver to.
    mockUnregister.mockResolvedValue({ unregistered: false });

    await expect(
      unregisterWebPushDevice({ endpoint, locale: "en", tenantId })
    ).resolves.toEqual({ ok: true });
  });

  it("reports a request the server rejected", async () => {
    mockUnregister.mockRejectedValue(
      new ConnectError("endpoint is required", Code.InvalidArgument)
    );

    const result = await unregisterWebPushDevice({
      endpoint,
      locale: "en",
      tenantId,
    });

    expect(result.ok).toBe(false);
  });
});
