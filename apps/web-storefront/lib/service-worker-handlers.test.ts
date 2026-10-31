import { describe, expect, it, vi } from "vitest";

import type {
  JsonValue,
  PushWorkerClient,
  PushWorkerNotificationClickEvent,
  PushWorkerPushEvent,
  PushWorkerScope,
} from "./service-worker-handlers";
import { registerPushHandlers } from "./service-worker-handlers";

const ORIGIN = "https://tenant.test";

interface Listeners {
  notificationclick?: (event: PushWorkerNotificationClickEvent) => void;
  push?: (event: PushWorkerPushEvent) => void;
}

const createScope = (clients: PushWorkerClient[] = []) => {
  const listeners: Listeners = {};

  const showNotification = vi
    .fn<PushWorkerScope["registration"]["showNotification"]>()
    .mockResolvedValue();

  const matchAll = vi
    .fn<PushWorkerScope["clients"]["matchAll"]>()
    .mockResolvedValue(clients);

  const openWindow = vi
    .fn<PushWorkerScope["clients"]["openWindow"]>()
    .mockResolvedValue(null);

  // Takes either overload's listener, and files it under the event it is for.
  const addEventListener: PushWorkerScope["addEventListener"] = (
    type: keyof Listeners,
    listener: (event: never) => void
  ) => {
    Object.assign(listeners, { [type]: listener });
  };

  const scope: PushWorkerScope = {
    addEventListener,
    clients: { matchAll, openWindow },
    location: { origin: ORIGIN },
    registration: { showNotification },
  };

  registerPushHandlers(scope);

  return { listeners, matchAll, openWindow, showNotification };
};

/** A `PushEvent` whose body is whatever `json()` is made to answer. */
const pushEvent = (json: () => JsonValue) => {
  const waited: Promise<unknown>[] = [];

  return {
    event: {
      data: { json },
      waitUntil: (promise: Promise<unknown>) => waited.push(promise),
    } satisfies PushWorkerPushEvent,
    settle: () => Promise.all(waited),
    waited,
  };
};

const clickEvent = (data: JsonValue) => {
  const waited: Promise<unknown>[] = [];
  const close = vi.fn();

  return {
    close,
    event: {
      notification: { close, data },
      waitUntil: (promise: Promise<unknown>) => waited.push(promise),
    } satisfies PushWorkerNotificationClickEvent,
    settle: () => Promise.all(waited),
  };
};

const windowClient = (url: string): PushWorkerClient => {
  const client: PushWorkerClient = {
    focus: vi.fn(() => Promise.resolve(client)),
    navigate: vi.fn(() => Promise.resolve(client)),
    url,
  };

  return client;
};

describe("registerPushHandlers", () => {
  it("draws the notification the server sent, tagged by the record behind it", async () => {
    const { listeners, showNotification } = createScope();

    const { event, settle } = pushEvent(() => ({
      body: "Episode 12",
      data: {
        notification_id: "8a7f4f0e-0000-4000-8000-000000000000",
        route: "/series/SR01/episodes/EP12",
      },
      title: "Example Series",
    }));

    listeners.push?.(event);
    await settle();

    expect(showNotification).toHaveBeenCalledWith("Example Series", {
      body: "Episode 12",
      data: {
        notification_id: "8a7f4f0e-0000-4000-8000-000000000000",
        route: "/series/SR01/episodes/EP12",
      },
      tag: "8a7f4f0e-0000-4000-8000-000000000000",
    });
  });

  it("draws nothing for a payload that is not JSON", async () => {
    const { listeners, showNotification } = createScope();

    const { event, settle, waited } = pushEvent(() => {
      throw new SyntaxError("not JSON");
    });

    listeners.push?.(event);
    await settle();

    expect(waited).toHaveLength(0);
    expect(showNotification).not.toHaveBeenCalled();
  });

  it("draws nothing for a payload that names no title", async () => {
    const { listeners, showNotification } = createScope();
    const { event, settle } = pushEvent(() => ({ body: "Episode 12" }));

    listeners.push?.(event);
    await settle();

    expect(showNotification).not.toHaveBeenCalled();
  });

  it("takes a window this site already has open to the route", async () => {
    const client = windowClient(`${ORIGIN}/my`);
    const { listeners, openWindow } = createScope([client]);

    const { close, event, settle } = clickEvent({
      route: "/series/SR01/episodes/EP12",
    });

    listeners.notificationclick?.(event);
    await settle();

    expect(close).toHaveBeenCalled();
    expect(client.focus).toHaveBeenCalled();
    expect(client.navigate).toHaveBeenCalledWith(
      `${ORIGIN}/series/SR01/episodes/EP12`
    );
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("opens a window when this site has none", async () => {
    const { listeners, openWindow } = createScope();

    const { event, settle } = clickEvent({
      route: "/series/SR01/episodes/EP12",
    });

    listeners.notificationclick?.(event);
    await settle();

    expect(openWindow).toHaveBeenCalledWith(
      `${ORIGIN}/series/SR01/episodes/EP12`
    );
  });

  it.each([
    ["an absolute URL", { route: "https://elsewhere.test/steal" }],
    ["a protocol-relative URL", { route: "//elsewhere.test/steal" }],
    // `URL` reads a backslash as a separator under a special scheme, so this
    // resolves off the origin while looking like an ordinary path.
    [
      "a backslash standing in for the second slash",
      { route: "/\\elsewhere.test/steal" },
    ],
    ["no route at all", { notification_id: "abc" }],
  ])("opens the site root for %s", async (_label, data) => {
    const { listeners, openWindow } = createScope();
    const { event, settle } = clickEvent(data);

    listeners.notificationclick?.(event);
    await settle();

    expect(openWindow).toHaveBeenCalledWith(`${ORIGIN}/`);
  });
});
