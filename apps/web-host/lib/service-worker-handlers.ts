/**
 * What the push service worker does once a message arrives: draw the
 * notification, and open what the reader tapped.
 *
 * The handlers are separated from `service-worker.ts` — the module Next.js
 * compiles into `_next/static/service-worker/` — so they can be driven by a
 * test with a stand-in scope instead of a real worker.
 */

/**
 * The message the outbox worker sends (`server/internal/push/web.go`). `title`
 * and `body` are the tenant's own content rather than copy, and `data` is the
 * routing block `notificationclick` reads.
 */
interface PushMessage {
  body: string;
  data: Record<string, string>;
  title: string;
}

/**
 * The pieces of `ServiceWorkerGlobalScope` this worker touches, declared here
 * rather than taken from `lib.webworker`: the app compiles against `lib.dom`,
 * where `self` is a `Window`, and loading both collides on every name they
 * share.
 */
export interface PushWorkerNotification {
  close: () => void;
  data: unknown;
}

export interface PushWorkerPushEvent {
  data: { json: () => unknown } | null;
  waitUntil: (promise: Promise<unknown>) => void;
}

export interface PushWorkerNotificationClickEvent {
  notification: PushWorkerNotification;
  waitUntil: (promise: Promise<unknown>) => void;
}

export interface PushWorkerClient {
  focus: () => Promise<unknown>;
  navigate: (url: string) => Promise<unknown>;
  url: string;
}

export interface PushWorkerScope {
  /** Overloaded, so each event type carries the event the handler receives. */
  addEventListener: {
    (type: "push", listener: (event: PushWorkerPushEvent) => void): void;
    (
      type: "notificationclick",
      listener: (event: PushWorkerNotificationClickEvent) => void
    ): void;
  };
  clients: {
    matchAll: (options: {
      includeUncontrolled: boolean;
      type: "window";
    }) => Promise<PushWorkerClient[]>;
    openWindow: (url: string) => Promise<unknown>;
  };
  location: { origin: string };
  registration: {
    showNotification: (
      title: string,
      options: { body?: string; data?: unknown; tag?: string }
    ) => Promise<void>;
  };
}

const isStringRecord = (value: unknown): value is Record<string, string> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every((entry) => typeof entry === "string");

/**
 * `null` for a payload this worker cannot draw a notification from. A push
 * arrives from the network, so it is parsed rather than trusted: an undecodable
 * body, or one naming no title, is dropped instead of showing the reader an
 * empty notification.
 *
 * This is the one boundary in the app where that check is written out by hand
 * rather than declared with zod. The worker is compiled as a browser bundle of
 * its own, and a dependency reaching for `node:process` fails that compilation
 * outright.
 */
const parsePushMessage = (event: PushWorkerPushEvent): PushMessage | null => {
  let raw: unknown;
  try {
    raw = event.data?.json();
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const { body, data, title } = raw as {
    body?: unknown;
    data?: unknown;
    title?: unknown;
  };
  if (typeof title !== "string" || title.trim() === "") {
    return null;
  }

  return {
    body: typeof body === "string" ? body : "",
    data: isStringRecord(data) ? data : {},
    title,
  };
};

/**
 * The URL a tap opens, always on this site's own origin.
 *
 * The server's `route` is a locale-less path (`/series/SR01/episodes/EP01`),
 * the same shape a stored `returnTo` has, so it lands on whichever language
 * the tenant serves its unprefixed URLs in. Anything that is not such a path —
 * an absolute URL, a protocol-relative one, an absent `route` — falls back to
 * the site root rather than sending the reader off the origin.
 */
const clickTargetUrl = (scope: PushWorkerScope, data: unknown): string => {
  const route =
    typeof data === "object" && data !== null && "route" in data
      ? (data as { route?: unknown }).route
      : undefined;
  const isSitePath =
    typeof route === "string" &&
    route.startsWith("/") &&
    !route.startsWith("//");

  return new URL(isSitePath ? route : "/", scope.location.origin).toString();
};

const showPushNotification = async (
  scope: PushWorkerScope,
  message: PushMessage
): Promise<void> => {
  const notificationId = message.data.notification_id;

  await scope.registration.showNotification(message.title, {
    body: message.body,
    data: message.data,
    // One notification per record, so a resent message replaces the one
    // already on screen instead of stacking a duplicate beside it.
    ...(notificationId ? { tag: notificationId } : {}),
  });
};

/**
 * Focus a window this site already has open and take it to the target, and
 * open a new one only when there is none. Opening unconditionally would leave
 * the reader with a second tab of the site they were already reading in.
 */
const openPushTarget = async (
  scope: PushWorkerScope,
  target: string
): Promise<void> => {
  const clients = await scope.clients.matchAll({
    includeUncontrolled: true,
    type: "window",
  });
  const existing = clients.find((client) =>
    client.url.startsWith(scope.location.origin)
  );
  if (existing) {
    await existing.focus();
    await existing.navigate(target);
    return;
  }

  await scope.clients.openWindow(target);
};

/** Wire both handlers onto the worker's global scope. */
export const registerPushHandlers = (scope: PushWorkerScope): void => {
  scope.addEventListener("push", (event) => {
    const message = parsePushMessage(event);
    if (!message) {
      return;
    }

    event.waitUntil(showPushNotification(scope, message));
  });

  scope.addEventListener("notificationclick", (event) => {
    event.notification.close();
    event.waitUntil(
      openPushTarget(scope, clickTargetUrl(scope, event.notification.data))
    );
  });
};
