// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BrowserNotificationsCard } from "./browser-notifications-card";

const {
  mockIsSupported,
  mockReadSubscription,
  mockRegisterAction,
  mockSubscribe,
  mockToKeys,
  mockUnregisterAction,
} = vi.hoisted(() => ({
  mockIsSupported: vi.fn(),
  mockReadSubscription: vi.fn(),
  mockRegisterAction: vi.fn(),
  mockSubscribe: vi.fn(),
  mockToKeys: vi.fn(),
  mockUnregisterAction: vi.fn(),
}));

vi.mock("#lib/browser-push", () => ({
  isBrowserPushSupported: mockIsSupported,
  readPushSubscription: mockReadSubscription,
  subscribeToPush: mockSubscribe,
  toWebPushSubscriptionKeys: mockToKeys,
}));

vi.mock("#lib/push-actions", () => ({
  registerBrowserPushAction: mockRegisterAction,
  unregisterBrowserPushAction: mockUnregisterAction,
}));

const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ENDPOINT = "https://push.test/subscriptions/abc";
const KEYS = { auth: "auth-key", endpoint: ENDPOINT, p256dh: "p256dh-key" };

const copy = {
  denied: "Notifications are turned off for this site.",
  description: "Be told in this browser when a new episode is published.",
  heading: "Browser notifications",
  label: "New episode notifications",
  turnOffFailed: "Could not turn notifications off. Try again.",
  turnOnFailed: "Could not turn notifications on. Try again.",
};

const renderCard = () =>
  render(
    <BrowserNotificationsCard
      copy={copy}
      locale="en"
      tenantId={TENANT_ID}
      vapidPublicKey="AAECAwQFBgcICQoLDA0ODw"
    />
  );

/** Throws unless the switch is on screen in exactly this state. */
const findSwitch = (checked: boolean) =>
  screen.findByRole("switch", { checked, name: copy.label });

/**
 * The toggle starts an async transition, so the click is flushed inside `act`
 * rather than left for an assertion to catch half-settled.
 */
const toggle = async (checked: boolean): Promise<void> => {
  const control = await findSwitch(checked);
  await act(() => {
    fireEvent.click(control);
  });
};

beforeEach(() => {
  mockIsSupported.mockReturnValue(true);
  mockReadSubscription.mockResolvedValue(null);
  mockToKeys.mockReturnValue(KEYS);
});

afterEach(cleanup);

describe("BrowserNotificationsCard", () => {
  it("leaves the card out entirely where the browser has no Push API", async () => {
    mockIsSupported.mockReturnValue(false);

    renderCard();

    await waitFor(() => {
      expect(screen.queryByText(copy.heading)).toBeNull();
    });
  });

  it("starts on for a browser that already holds a subscription", async () => {
    mockReadSubscription.mockResolvedValue({ endpoint: ENDPOINT });

    renderCard();

    expect(await findSwitch(true)).toBeTruthy();
  });

  it("subscribes and registers the browser when the reader turns it on", async () => {
    const subscription = { endpoint: ENDPOINT, unsubscribe: vi.fn() };
    mockSubscribe.mockResolvedValue(subscription);
    mockRegisterAction.mockResolvedValue({ ok: true });

    renderCard();
    await toggle(false);

    expect(await findSwitch(true)).toBeTruthy();
    expect(mockRegisterAction).toHaveBeenCalledWith({
      ...KEYS,
      locale: "en",
      tenantId: TENANT_ID,
    });
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
  });

  it("settles back to off and points at browser settings when permission is refused", async () => {
    mockSubscribe.mockResolvedValue("denied");

    renderCard();
    await toggle(false);

    expect(await screen.findByText(copy.denied)).toBeTruthy();
    expect(await findSwitch(false)).toBeTruthy();
    expect(mockRegisterAction).not.toHaveBeenCalled();
  });

  it("says to try again, not to visit settings, when the prompt is dismissed", async () => {
    // Closing the prompt stores no decision, so there is nothing in the
    // browser's settings for the denied copy to point the reader at.
    mockSubscribe.mockResolvedValue("dismissed");

    renderCard();
    await toggle(false);

    expect(await screen.findByText(copy.turnOnFailed)).toBeTruthy();
    expect(screen.queryByText(copy.denied)).toBeNull();
    expect(await findSwitch(false)).toBeTruthy();
    expect(mockRegisterAction).not.toHaveBeenCalled();
  });

  it("drops the subscription again when the server refuses the registration", async () => {
    const subscription = { endpoint: ENDPOINT, unsubscribe: vi.fn() };
    mockSubscribe.mockResolvedValue(subscription);
    mockRegisterAction.mockResolvedValue({
      message: "Sign in to continue.",
      ok: false,
    });

    renderCard();
    await toggle(false);

    expect(await screen.findByText("Sign in to continue.")).toBeTruthy();
    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(await findSwitch(false)).toBeTruthy();
  });

  it("gives the subscription back when the registration fails outright", async () => {
    const subscription = { endpoint: ENDPOINT, unsubscribe: vi.fn() };
    mockSubscribe.mockResolvedValue(subscription);
    mockRegisterAction.mockRejectedValue(new Error("the API is unreachable"));

    renderCard();
    await toggle(false);

    expect(await screen.findByText(copy.turnOnFailed)).toBeTruthy();
    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(await findSwitch(false)).toBeTruthy();
  });

  it("keeps the switch on and says so when the browser cannot be read", async () => {
    mockReadSubscription.mockResolvedValueOnce({ endpoint: ENDPOINT });
    mockReadSubscription.mockRejectedValue(new Error("the worker is gone"));

    renderCard();
    await toggle(true);

    expect(await screen.findByText(copy.turnOffFailed)).toBeTruthy();
    expect(await findSwitch(true)).toBeTruthy();
  });

  it("unregisters on the server before unsubscribing the browser", async () => {
    const subscription = { endpoint: ENDPOINT, unsubscribe: vi.fn() };
    mockReadSubscription.mockResolvedValue(subscription);
    mockUnregisterAction.mockResolvedValue({ ok: true });

    renderCard();
    await toggle(true);

    expect(await findSwitch(false)).toBeTruthy();
    expect(mockUnregisterAction).toHaveBeenCalledWith({
      endpoint: ENDPOINT,
      locale: "en",
      tenantId: TENANT_ID,
    });
    expect(subscription.unsubscribe).toHaveBeenCalled();
  });

  it("keeps the switch on when the server could not unregister the browser", async () => {
    const subscription = { endpoint: ENDPOINT, unsubscribe: vi.fn() };
    mockReadSubscription.mockResolvedValue(subscription);
    mockUnregisterAction.mockResolvedValue({
      message: copy.turnOffFailed,
      ok: false,
    });

    renderCard();
    await toggle(true);

    expect(await screen.findByText(copy.turnOffFailed)).toBeTruthy();
    expect(await findSwitch(true)).toBeTruthy();
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
  });
});
