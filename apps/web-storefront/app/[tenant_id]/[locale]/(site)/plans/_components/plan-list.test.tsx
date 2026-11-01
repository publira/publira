// @vitest-environment jsdom

import type { MessageValues } from "@publira/i18n";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as ApiClientModule from "#lib/api-client";
import type * as SubscriptionsModule from "#lib/subscriptions";

import { PlanList } from "./plan-list";

const { mockGetMySubscription, mockListSubscriptionPlans } = vi.hoisted(() => ({
  mockGetMySubscription: vi.fn(),
  mockListSubscriptionPlans: vi.fn(),
}));

vi.mock("#lib/tenant-id", () => ({
  getTenantId: () => Promise.resolve("11111111-1111-4111-8111-111111111111"),
}));

vi.mock("#lib/locale", () => ({
  getLocale: () => Promise.resolve("en"),
}));

vi.mock("#lib/api-client", async () => {
  const actual =
    await vi.importActual<typeof ApiClientModule>("#lib/api-client");

  return {
    ...actual,
    resolveAccessToken: () => Promise.resolve("session-token"),
  };
});

vi.mock("#lib/subscriptions", async () => {
  const actual =
    await vi.importActual<typeof SubscriptionsModule>("#lib/subscriptions");

  return {
    ...actual,
    getMySubscription: mockGetMySubscription,
    listSubscriptionPlans: mockListSubscriptionPlans,
  };
});

vi.mock("#lib/tenant", () => ({
  getTenantSiteInfo: () => Promise.resolve({ acceptsPayments: true }),
}));

vi.mock("../_lib/actions", () => ({
  startSubscriptionCheckoutAction: vi.fn(),
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

vi.mock("#components/series-shelf", () => ({
  Root: () => null,
}));

afterEach(cleanup);

const held = (
  store: SubscriptionsModule.SubscriptionItem["store"],
  status: SubscriptionsModule.SubscriptionItem["status"] = "active"
): SubscriptionsModule.SubscriptionItem => ({
  cancelAtPeriodEnd: false,
  currentPeriodEnd: "2026-12-01T00:00:00Z",
  plan: { name: "Night pass" },
  status,
  store,
});

beforeEach(() => {
  mockGetMySubscription.mockReset();
  mockListSubscriptionPlans.mockReset();
  mockListSubscriptionPlans.mockResolvedValue({
    ok: true,
    value: [
      {
        currency: "JPY",
        description: "",
        id: "plan-id",
        interval: "month",
        intervalCount: 1,
        labels: [],
        name: "Night pass",
        priceAmount: 980,
        scope: "all",
        series: [],
      },
    ],
  });
});

const renderList = async () => {
  render(<div>{await PlanList()}</div>);
};

const subscribe = () =>
  screen.queryByRole("button", { name: "storefront.plans.subscribe" });

describe("PlanList", () => {
  it("names the store when the reader already holds its plan", async () => {
    mockGetMySubscription.mockResolvedValue({
      ok: true,
      subscription: held("app_store"),
    });

    await renderList();

    expect(
      screen.getByText("storefront.plans.already_subscribed_app_store")
    ).toBeTruthy();
    expect(subscribe()).toBeNull();
  });

  it("keeps the Stripe message when Stripe bills the plan the reader holds", async () => {
    mockGetMySubscription.mockResolvedValue({
      ok: true,
      subscription: held(null),
    });

    await renderList();

    expect(
      screen.getByText("storefront.plans.already_subscribed")
    ).toBeTruthy();
    expect(
      screen.queryByText("storefront.plans.already_subscribed_app_store")
    ).toBeNull();
    expect(subscribe()).toBeNull();
  });

  it("still sells a plan after a store subscription has ended", async () => {
    mockGetMySubscription.mockResolvedValue({
      ok: true,
      subscription: held("google_play", "canceled"),
    });

    await renderList();

    expect(
      screen.queryByText("storefront.plans.already_subscribed_google_play")
    ).toBeNull();
    expect(subscribe()).toBeTruthy();
  });
});
