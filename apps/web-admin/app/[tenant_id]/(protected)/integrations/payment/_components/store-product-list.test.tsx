// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SubscriptionPlanItem } from "#lib/subscription-plan-shared";

import { StoreProductList } from "./store-product-list";

vi.mock("#lib/messages", () => ({
  getMessagesFor: () =>
    Promise.resolve(bindMessages(sharedCatalog("en"), "en")),
}));

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
}));

const plan: SubscriptionPlanItem = {
  appStoreProductId: "monthly_pass",
  currency: "JPY",
  description: "",
  googlePlayProductId: "monthly.pass",
  id: "018f0e6a-7000-7000-8000-000000000001",
  interval: "month",
  intervalCount: 1,
  labelIds: [],
  name: "Monthly pass",
  priceAmount: 980,
  publicId: "PLAN0001",
  published: true,
  scope: "all",
  seriesIds: [],
  stripePriceId: "price_monthly",
  subscriberCount: 0,
};

afterEach(() => {
  cleanup();
});

describe("StoreProductList", () => {
  it("lists each product ID with its price and how many episodes sell at it", async () => {
    render(
      await StoreProductList({
        locale: "en",
        products: [
          {
            currency: "JPY",
            episodeCount: 2,
            price: 300,
            productId: "episode_300",
          },
          {
            currency: "USD",
            episodeCount: 1,
            price: 1200,
            productId: "episode_1200",
          },
        ],
        subscriptionPlans: [],
      })
    );

    const [, first, second] = screen.getAllByRole("row");
    expect(within(first).getByText("episode_300")).toBeDefined();
    expect(within(first).getByText("¥300")).toBeDefined();
    expect(within(first).getByText("2")).toBeDefined();
    expect(
      within(first).getByRole("button", { name: "Copy the product ID" })
    ).toBeDefined();
    expect(within(second).getByText("episode_1200")).toBeDefined();
    expect(within(second).getByText("$12.00")).toBeDefined();
  });

  it("names the pack a coin product sells and who names it in the stores", async () => {
    render(
      await StoreProductList({
        locale: "en",
        products: [
          {
            currency: "JPY",
            episodeCount: 1,
            price: 300,
            productId: "episode_300",
          },
          {
            coinPack: { bonusCoins: 20, coins: 100 },
            currency: "JPY",
            episodeCount: 0,
            price: 1000,
            productId: "coins_0190a0a0000070008000000000000003",
          },
        ],
        subscriptionPlans: [],
      })
    );

    const [, episode, pack] = screen.getAllByRole("row");
    expect(within(episode).queryByText(/Coin pack/u)).toBeNull();
    expect(
      within(pack).getByText("coins_0190a0a0000070008000000000000003")
    ).toBeDefined();
    expect(
      within(pack).getByText("Coin pack (120 coins, including 20 bonus)")
    ).toBeDefined();
    expect(within(pack).queryByText("0")).toBeNull();
    expect(
      screen.getByText(/name each pack's product with your own word/u)
    ).toBeDefined();
  });

  it("says nothing about coin packs while none is listed", async () => {
    render(
      await StoreProductList({
        locale: "en",
        products: [
          {
            currency: "JPY",
            episodeCount: 1,
            price: 300,
            productId: "episode_300",
          },
        ],
        subscriptionPlans: [],
      })
    );

    expect(screen.queryByText(/coin pack/iu)).toBeNull();
  });

  it("says no product is needed while the app sells no paid episode", async () => {
    render(
      await StoreProductList({
        locale: "en",
        products: [],
        subscriptionPlans: [],
      })
    );

    expect(screen.getByText("No products needed yet")).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("lists the product each store sells a plan as, beside the plan's billing", async () => {
    render(
      await StoreProductList({
        locale: "en",
        products: [
          {
            currency: "JPY",
            episodeCount: 1,
            price: 300,
            productId: "episode_300",
          },
        ],
        subscriptionPlans: [
          plan,
          {
            ...plan,
            appStoreProductId: "yearly_pass",
            googlePlayProductId: "",
            id: "018f0e6a-7000-7000-8000-000000000002",
            interval: "year",
            name: "Yearly pass",
            priceAmount: 9800,
          },
        ],
      })
    );

    expect(
      screen.getByRole("heading", { name: "Subscription plans" })
    ).toBeDefined();
    const [, plans] = screen.getAllByRole("table");
    const [, monthly, yearly] = within(plans).getAllByRole("row");
    expect(within(monthly).getByText("Monthly pass")).toBeDefined();
    expect(within(monthly).getByText("¥980 a month")).toBeDefined();
    expect(within(monthly).getByText("monthly_pass")).toBeDefined();
    expect(within(monthly).getByText("monthly.pass")).toBeDefined();
    expect(
      within(monthly).getAllByRole("button", { name: "Copy the product ID" })
    ).toHaveLength(2);
    expect(within(yearly).getByText("yearly_pass")).toBeDefined();
    expect(within(yearly).getByText("Not sold")).toBeDefined();
  });

  it("lists a plan's products while the app sells no paid episode", async () => {
    render(
      await StoreProductList({
        locale: "en",
        products: [],
        subscriptionPlans: [plan],
      })
    );

    expect(screen.queryByText("No products needed yet")).toBeNull();
    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(screen.getByText("monthly_pass")).toBeDefined();
  });

  it("says nothing about plans while none names a store product", async () => {
    render(
      await StoreProductList({
        locale: "en",
        products: [
          {
            currency: "JPY",
            episodeCount: 1,
            price: 300,
            productId: "episode_300",
          },
        ],
        subscriptionPlans: [],
      })
    );

    expect(
      screen.queryByRole("heading", { name: "Subscription plans" })
    ).toBeNull();
    expect(screen.getAllByRole("table")).toHaveLength(1);
  });

  it("shows why the list is missing instead of an empty list", async () => {
    render(
      await StoreProductList({
        listErrorMessage:
          "Could not load the store products. Please try again later.",
        locale: "en",
        products: [],
        subscriptionPlans: [],
      })
    );

    expect(
      screen.getByText("Could not display the store products")
    ).toBeDefined();
    expect(
      screen.getByText(
        "Could not load the store products. Please try again later."
      )
    ).toBeDefined();
    expect(screen.queryByText("No products needed yet")).toBeNull();
  });
});
