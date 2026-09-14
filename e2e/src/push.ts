import type { Page } from "@playwright/test";

/**
 * The endpoint the stubbed push service issues. It belongs to no real service:
 * nothing is ever delivered through it, and the server only ever stores it and
 * gives it back.
 */
export const STUB_PUSH_ENDPOINT =
  "https://push.e2e.test/subscriptions/host-e2e";

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
 */
export const stubPushApi = async (
  page: Page,
  permission: "denied" | "granted"
): Promise<void> => {
  await page.addInitScript(
    ([endpoint, granted]) => {
      let subscription: unknown = null;
      const registration = {
        pushManager: {
          getSubscription: () => Promise.resolve(subscription),
          subscribe: () => {
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
    [STUB_PUSH_ENDPOINT, permission === "granted"] as const
  );
};
