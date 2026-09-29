import type { Page } from "@playwright/test";

import { querySql } from "./db";

/**
 * The endpoint the stubbed push service issues. It belongs to no real service:
 * nothing is ever delivered through it, and the server only ever stores it and
 * gives it back.
 */
export const STUB_PUSH_ENDPOINT =
  "https://push.e2e.test/subscriptions/host-e2e";

/**
 * The VAPID public key this stack's API publishes, which is what the browser
 * has to subscribe with. Read from the stored settings rather than restated,
 * so the stub checks against whatever key the server answers with.
 */
const vapidPublicKey = (): string => {
  const key = querySql(
    "SELECT vapid_public_key FROM platform_webpush_config WHERE subject IS NOT NULL;"
  );
  if (!key) {
    throw new Error(
      "Web Push is not configured on this stack (applied by e2e/scripts/db-setup.sh)"
    );
  }
  return key;
};

/**
 * Stand in for the browser's Push API, so a run can drive the notification
 * switch end to end.
 *
 * Chromium has the real APIs on `http://localhost`, and they cannot be used
 * here: `Notification.requestPermission()` opens a prompt no test can answer,
 * and `pushManager.subscribe()` talks to Google's push service over the
 * network. The stub keeps everything the app does around them — the service
 * worker registration, the subscription's JSON form, the unsubscribe — so what
 * the spec asserts is still the app's own sequence.
 *
 * `subscribe` checks its arguments rather than ignoring them. A stub that
 * accepted anything would pass just as well if web-host stopped sending
 * `userVisibleOnly`, or sent a key that was not this tenant's — the two things
 * a real push service would reject the subscription over, and the two a test
 * against a stub would otherwise never see.
 */
export const stubPushApi = async (
  page: Page,
  permission: "denied" | "granted"
): Promise<void> => {
  await page.addInitScript(
    ([endpoint, expectedKey, granted]) => {
      // The key as `pushManager.subscribe` receives it: base64url off the
      // wire, bytes in the call.
      const base64 = (expectedKey as string)
        .replaceAll("-", "+")
        .replaceAll("_", "/");
      const padded = base64.padEnd(
        base64.length + ((4 - (base64.length % 4)) % 4),
        "="
      );
      const binary = window.atob(padded);
      const expectedKeyBytes = new Uint8Array(binary.length);
      expectedKeyBytes.set(
        Array.from(binary, (character) => character.codePointAt(0) ?? 0)
      );

      let subscription: unknown = null;
      const registration = {
        pushManager: {
          getSubscription: () => Promise.resolve(subscription),
          subscribe: (options?: {
            applicationServerKey?: unknown;
            userVisibleOnly?: unknown;
          }) => {
            if (options?.userVisibleOnly !== true) {
              return Promise.reject(
                new Error("stub push service: userVisibleOnly must be true")
              );
            }
            const key = options.applicationServerKey;
            const actual = key instanceof Uint8Array ? key : new Uint8Array();
            const matches =
              actual.length === expectedKeyBytes.length &&
              expectedKeyBytes.every((byte, index) => actual[index] === byte);
            if (!matches) {
              return Promise.reject(
                new Error(
                  "stub push service: applicationServerKey is not this tenant's VAPID key"
                )
              );
            }

            subscription = {
              endpoint,
              toJSON: () => ({
                endpoint,
                keys: { auth: "c3R1YkF1dGhLZXk", p256dh: "c3R1YlAyNTZkaEtleQ" },
              }),
              unsubscribe: () => {
                subscription = null;
                return Promise.resolve(true);
              },
            };
            return Promise.resolve(subscription);
          },
        },
      };

      Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        value: {
          getRegistration: () => Promise.resolve(registration),
          ready: Promise.resolve(registration),
          register: () => Promise.resolve(registration),
        },
      });
      Object.defineProperty(window, "Notification", {
        configurable: true,
        value: {
          permission: granted ? "granted" : "default",
          requestPermission: () =>
            Promise.resolve(granted ? "granted" : "denied"),
        },
      });
    },
    [STUB_PUSH_ENDPOINT, vapidPublicKey(), permission === "granted"] as const
  );
};
