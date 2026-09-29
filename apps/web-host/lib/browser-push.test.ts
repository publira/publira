// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isBrowserPushSupported,
  readPushSubscription,
  subscribeToPush,
  toWebPushSubscriptionKeys,
} from "./browser-push";

const ENDPOINT = "https://push.test/subscriptions/abc";

/**
 * The VAPID key the server publishes is base64url without padding, which is
 * what {@link subscribeToPush} has to put back before `atob` will read it.
 * This one decodes to the bytes 0..15.
 */
const VAPID_PUBLIC_KEY = "AAECAwQFBgcICQoLDA0ODw";

const installPushApi = (registration?: unknown) => {
  const register = vi.fn().mockResolvedValue(registration);
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      getRegistration: vi.fn().mockResolvedValue(registration),
      ready: Promise.resolve(registration),
      register,
    },
  });
  Object.defineProperty(window, "PushManager", {
    configurable: true,
    value: {},
  });

  return { register };
};

const installNotificationApi = (permission: NotificationPermission) => {
  const requestPermission = vi.fn().mockResolvedValue(permission);
  Object.defineProperty(window, "Notification", {
    configurable: true,
    value: { requestPermission },
  });

  return { requestPermission };
};

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "serviceWorker");
  Reflect.deleteProperty(window, "PushManager");
  Reflect.deleteProperty(window, "Notification");
});

describe("isBrowserPushSupported", () => {
  it("is false while the browser exposes no Push API", () => {
    expect(isBrowserPushSupported()).toBe(false);
  });

  it("is true once the three APIs a subscription needs are present", () => {
    installPushApi({});
    installNotificationApi("default");

    expect(isBrowserPushSupported()).toBe(true);
  });
});

describe("readPushSubscription", () => {
  it("answers the subscription the existing registration holds", async () => {
    const subscription = { endpoint: ENDPOINT };
    installPushApi({
      pushManager: { getSubscription: vi.fn().mockResolvedValue(subscription) },
    });

    await expect(readPushSubscription()).resolves.toBe(subscription);
  });

  it("answers null, without registering a worker, when there is no registration", async () => {
    const { register } = installPushApi();

    await expect(readPushSubscription()).resolves.toBeNull();
    expect(register).not.toHaveBeenCalled();
  });
});

describe("subscribeToPush", () => {
  it("subscribes with the decoded application server key", async () => {
    const subscription = { endpoint: ENDPOINT };
    const subscribe = vi.fn().mockResolvedValue(subscription);
    const { register } = installPushApi({ pushManager: { subscribe } });
    installNotificationApi("granted");

    await expect(subscribeToPush(VAPID_PUBLIC_KEY)).resolves.toBe(subscription);

    expect(register).toHaveBeenCalledWith(expect.any(URL), {
      scope: "/",
      updateViaCache: "none",
    });
    expect(subscribe).toHaveBeenCalledWith({
      applicationServerKey: Uint8Array.from({ length: 16 }, (_, i) => i),
      userVisibleOnly: true,
    });
  });

  it("reports a refused permission without registering a worker", async () => {
    const { register } = installPushApi({});
    installNotificationApi("denied");

    await expect(subscribeToPush(VAPID_PUBLIC_KEY)).resolves.toBe("denied");
    expect(register).not.toHaveBeenCalled();
  });

  it("keeps a dismissed prompt apart from a refusal the browser stored", async () => {
    // `requestPermission()` resolves `"default"` when the reader closes the
    // prompt without answering. Nothing is stored, so the browser's settings
    // hold nothing for them to turn back on.
    installPushApi({});
    installNotificationApi("default");

    await expect(subscribeToPush(VAPID_PUBLIC_KEY)).resolves.toBe("dismissed");
  });
});

describe("toWebPushSubscriptionKeys", () => {
  it("takes the endpoint and both keys off the subscription's JSON form", () => {
    const subscription = {
      toJSON: () => ({
        endpoint: ENDPOINT,
        keys: { auth: "auth-key", p256dh: "p256dh-key" },
      }),
    } as unknown as PushSubscription;

    expect(toWebPushSubscriptionKeys(subscription)).toEqual({
      auth: "auth-key",
      endpoint: ENDPOINT,
      p256dh: "p256dh-key",
    });
  });

  it("reports a subscription missing a key rather than registering it half-filled", () => {
    const subscription = {
      toJSON: () => ({ endpoint: ENDPOINT, keys: { auth: "auth-key" } }),
    } as unknown as PushSubscription;

    expect(toWebPushSubscriptionKeys(subscription)).toBeNull();
  });
});
