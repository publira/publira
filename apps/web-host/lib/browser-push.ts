/**
 * The browser half of Web Push: the service worker registration, the
 * subscription, and the shape the server is told about.
 *
 * Every function here touches `navigator`, so it runs only in the browser and
 * only from a Client Component. The registration lives in this module rather
 * than at its call site because `new URL("service-worker", import.meta.url)`
 * is how Next.js finds the worker to compile, and that specifier has to be
 * relative to the file the worker sits beside.
 */

/** What `RegisterPushDevice` needs from a `PushSubscription`. */
export interface WebPushSubscriptionKeys {
  auth: string;
  endpoint: string;
  p256dh: string;
}

/**
 * Whether this browser can be subscribed at all. Safari before 16, and any
 * browser with service workers turned off, answers `false` — the card is left
 * out rather than shown as a switch that cannot move.
 */
export const isBrowserPushSupported = (): boolean =>
  typeof navigator !== "undefined" &&
  "serviceWorker" in navigator &&
  typeof window !== "undefined" &&
  "PushManager" in window &&
  "Notification" in window;

/**
 * This browser's subscription, or `null` when it has none.
 *
 * It reads the existing registration instead of creating one, so opening the
 * settings screen does not install a worker on a reader who never turns
 * notifications on.
 */
export const readPushSubscription =
  async (): Promise<PushSubscription | null> => {
    const registration = await navigator.serviceWorker.getRegistration();

    return (await registration?.pushManager.getSubscription()) ?? null;
  };

/**
 * The VAPID public key as the `Uint8Array` `pushManager.subscribe` wants. The
 * server publishes it base64url-encoded, which `atob` does not read, so the
 * URL-safe alphabet and the stripped padding are put back first.
 */
const toApplicationServerKey = (
  vapidPublicKey: string
): Uint8Array<ArrayBuffer> => {
  const base64 = vapidPublicKey.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(
    base64.length + ((4 - (base64.length % 4)) % 4),
    "="
  );
  const binary = window.atob(padded);
  const bytes = new Uint8Array(binary.length);
  bytes.set(Array.from(binary, (character) => character.codePointAt(0) ?? 0));

  return bytes;
};

/**
 * Register the push worker and wait for it to become the active one.
 *
 * `scope: "/"` is wider than the `_next/static/service-worker/` directory the
 * script is served from, which the `Service-Worker-Allowed` header Next.js
 * sends with it is what permits. `updateViaCache: "none"` keeps the browser
 * from taking a worker out of its HTTP cache after a deploy.
 */
const registerPushServiceWorker =
  async (): Promise<ServiceWorkerRegistration> => {
    await navigator.serviceWorker.register(
      new URL("service-worker", import.meta.url),
      { scope: "/", updateViaCache: "none" }
    );

    return await navigator.serviceWorker.ready;
  };

/**
 * Ask the reader for permission and subscribe. The prompt is raised here and
 * nowhere else, so it only ever follows the reader turning the switch on.
 *
 * The two refusals are kept apart because only one of them can be undone where
 * the copy would send the reader. `"denied"` is a decision the browser has
 * stored, and its settings are where it is taken back; `"dismissed"` is the
 * reader closing the prompt without answering — nothing is stored, nothing is
 * there to turn on, and pressing the switch again asks them once more.
 */
export const subscribeToPush = async (
  vapidPublicKey: string
): Promise<PushSubscription | "denied" | "dismissed"> => {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return permission === "denied" ? "denied" : "dismissed";
  }

  const registration = await registerPushServiceWorker();

  return await registration.pushManager.subscribe({
    applicationServerKey: toApplicationServerKey(vapidPublicKey),
    userVisibleOnly: true,
  });
};

/**
 * The subscription as the server stores it. `PushSubscription.toJSON()` is what
 * carries the two keys — they are `ArrayBuffer`s on the object itself — and a
 * subscription missing either is one the push service cannot be talked to
 * through, so it is reported rather than registered half-filled.
 */
export const toWebPushSubscriptionKeys = (
  subscription: PushSubscription
): WebPushSubscriptionKeys | null => {
  const { endpoint, keys } = subscription.toJSON();
  const auth = keys?.auth;
  const p256dh = keys?.p256dh;
  if (!(endpoint && auth && p256dh)) {
    return null;
  }

  return { auth, endpoint, p256dh };
};
