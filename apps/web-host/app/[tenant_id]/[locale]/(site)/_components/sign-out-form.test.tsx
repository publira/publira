// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SignOutForm } from "./sign-out-form";

const { mockIsSupported, mockReadSubscription, mockUnregisterAction } =
  vi.hoisted(() => ({
    mockIsSupported: vi.fn(),
    mockReadSubscription: vi.fn(),
    mockUnregisterAction: vi.fn(),
  }));

vi.mock("#lib/browser-push", () => ({
  isBrowserPushSupported: mockIsSupported,
  readPushSubscription: mockReadSubscription,
}));

vi.mock("#lib/push-actions", () => ({
  unregisterBrowserPushAction: mockUnregisterAction,
}));

vi.mock("@publira/layouts", () => ({
  SiteLayoutUserMenuLogout: ({
    action,
    children,
  }: {
    action: (formData: FormData) => Promise<void>;
    children: React.ReactNode;
  }) => <form action={action}>{children}</form>,
}));

const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ENDPOINT = "https://push.test/subscriptions/abc";

const submit = async (signOut: (formData: FormData) => Promise<void>) => {
  render(
    <SignOutForm locale="en" signOut={signOut} tenantId={TENANT_ID}>
      <button type="submit">Sign out</button>
    </SignOutForm>
  );

  await act(() => {
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  });
};

beforeEach(() => {
  mockIsSupported.mockReturnValue(true);
  mockReadSubscription.mockResolvedValue(null);
  mockUnregisterAction.mockResolvedValue({ ok: true });
});

afterEach(cleanup);

describe("SignOutForm", () => {
  it("drops this browser's registration before ending the session", async () => {
    const order: string[] = [];
    const subscription = {
      endpoint: ENDPOINT,
      unsubscribe: vi.fn(() => {
        order.push("unsubscribe");
      }),
    };
    mockReadSubscription.mockResolvedValue(subscription);
    mockUnregisterAction.mockImplementation(() => {
      order.push("unregister");
      return Promise.resolve({ ok: true });
    });
    const signOut = vi.fn(() => {
      order.push("signOut");
      return Promise.resolve();
    });

    await submit(signOut);

    expect(mockUnregisterAction).toHaveBeenCalledWith({
      endpoint: ENDPOINT,
      locale: "en",
      tenantId: TENANT_ID,
    });
    expect(order).toEqual(["unregister", "unsubscribe", "signOut"]);
  });

  it("signs out without asking the Push API where the browser supports none", async () => {
    mockIsSupported.mockReturnValue(false);
    const signOut = vi.fn().mockResolvedValue(true);

    await submit(signOut);

    expect(mockReadSubscription).not.toHaveBeenCalled();
    expect(signOut).toHaveBeenCalled();
  });

  it("signs out even when the subscription cannot be dropped", async () => {
    mockReadSubscription.mockRejectedValue(new Error("worker is gone"));
    const signOut = vi.fn().mockResolvedValue(true);

    await submit(signOut);

    expect(signOut).toHaveBeenCalled();
  });
});
