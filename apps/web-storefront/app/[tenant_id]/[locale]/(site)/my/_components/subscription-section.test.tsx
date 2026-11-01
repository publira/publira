// @vitest-environment jsdom

import type { MessageValues } from "@publira/i18n";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as SubscriptionsModule from "#lib/subscriptions";

import { SubscriptionSection } from "./subscription-section";

const { mockGetMySubscription, mockGetTenantDisplayTimeZone } = vi.hoisted(
  () => ({
    mockGetMySubscription: vi.fn(),
    mockGetTenantDisplayTimeZone: vi.fn(),
  })
);

vi.mock("#lib/tenant-id", () => ({
  getTenantId: () => Promise.resolve("11111111-1111-4111-8111-111111111111"),
}));

vi.mock("#lib/locale", () => ({
  getLocale: () => Promise.resolve("en"),
}));

vi.mock("#lib/subscriptions", async () => {
  const actual =
    await vi.importActual<typeof SubscriptionsModule>("#lib/subscriptions");

  return {
    ...actual,
    getMySubscription: mockGetMySubscription,
  };
});

vi.mock("#lib/tenant", () => ({
  getTenantDisplayTimeZone: mockGetTenantDisplayTimeZone,
  getTenantSiteInfo: vi.fn(),
}));

vi.mock("#lib/auth-session", () => ({
  redirectToLogin: vi.fn(),
}));

vi.mock("../_lib/actions", () => ({
  openBillingPortalAction: vi.fn(),
}));

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: string;
    values?: MessageValues;
  }) => <span data-values={JSON.stringify(values ?? {})}>{message}</span>,
}));

vi.mock("#components/locale-field", () => ({
  LocaleField: () => null,
}));

vi.mock("#components/locale-link", () => ({
  LocaleLink: ({
    children,
    href,
    ...props
  }: { children: ReactNode; href: string } & ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

beforeEach(() => {
  mockGetMySubscription.mockReset();
  mockGetTenantDisplayTimeZone.mockReset();
  mockGetTenantDisplayTimeZone.mockResolvedValue("UTC");
});

const subscription = (
  overrides: Partial<SubscriptionsModule.SubscriptionItem> = {}
): SubscriptionsModule.SubscriptionItem => ({
  cancelAtPeriodEnd: false,
  currentPeriodEnd: "2026-12-01T00:00:00Z",
  plan: { name: "Night pass" },
  status: "active",
  store: null,
  ...overrides,
});

const renderSection = async () => {
  render(<div>{await SubscriptionSection()}</div>);
};

const manageBilling = () =>
  screen.queryByRole("button", { name: "storefront.my.manage_billing" });

const seePlans = () =>
  screen.queryByRole("link", { name: "storefront.my.to_plans" });

describe("SubscriptionSection", () => {
  it("offers Stripe's billing portal for a subscription Stripe bills", async () => {
    mockGetMySubscription.mockResolvedValue({
      ok: true,
      subscription: subscription(),
    });

    await renderSection();

    expect(screen.getByText("Night pass")).toBeTruthy();
    expect(screen.getByText("storefront.my.plan_renews_on")).toBeTruthy();
    expect(manageBilling()).toBeTruthy();
    expect(
      screen.queryByText("storefront.my.billed_through_app_store")
    ).toBeNull();
    expect(
      screen.queryByRole("link", {
        name: "storefront.my.manage_in_app_store",
      })
    ).toBeNull();
    expect(seePlans()).toBeNull();
  });

  it("points an App Store subscription at the App Store", async () => {
    mockGetMySubscription.mockResolvedValue({
      ok: true,
      subscription: subscription({ store: "app_store" }),
    });

    await renderSection();

    expect(
      screen.getByText("storefront.my.billed_through_app_store")
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "storefront.my.manage_in_app_store" })
        .getAttribute("href")
    ).toBe("https://apps.apple.com/account/subscriptions");
    expect(manageBilling()).toBeNull();
    expect(seePlans()).toBeNull();
  });

  it("tells a reader whose Google Play payment failed to update it there", async () => {
    mockGetMySubscription.mockResolvedValue({
      ok: true,
      subscription: subscription({ status: "past_due", store: "google_play" }),
    });

    await renderSection();

    expect(
      screen.getByText("storefront.my.plan_past_due_google_play")
    ).toBeTruthy();
    expect(
      screen.getByText("storefront.my.billed_through_google_play")
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "storefront.my.manage_in_google_play" })
        .getAttribute("href")
    ).toBe("https://play.google.com/store/account/subscriptions");
    expect(screen.queryByText("storefront.my.plan_past_due")).toBeNull();
    expect(manageBilling()).toBeNull();
  });

  it("names the App Store when a plan it bills is on hold", async () => {
    mockGetMySubscription.mockResolvedValue({
      ok: true,
      subscription: subscription({ status: "paused", store: "app_store" }),
    });

    await renderSection();

    expect(
      screen.getByText("storefront.my.plan_on_hold_app_store")
    ).toBeTruthy();
    expect(screen.queryByText("storefront.my.plan_on_hold")).toBeNull();
  });

  it("offers the plans again when a store subscription has ended", async () => {
    mockGetMySubscription.mockResolvedValue({
      ok: true,
      subscription: subscription({ status: "canceled", store: "app_store" }),
    });

    await renderSection();

    expect(screen.getByText("storefront.my.plan_ended")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "storefront.my.manage_in_app_store" })
    ).toBeTruthy();
    expect(seePlans()).toBeTruthy();
    expect(manageBilling()).toBeNull();
  });
});
