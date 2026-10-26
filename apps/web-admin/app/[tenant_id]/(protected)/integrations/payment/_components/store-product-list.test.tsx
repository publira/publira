// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
      })
    );

    expect(screen.queryByText(/coin pack/iu)).toBeNull();
  });

  it("says no product is needed while the app sells no paid episode", async () => {
    render(await StoreProductList({ locale: "en", products: [] }));

    expect(screen.getByText("No products needed yet")).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows why the list is missing instead of an empty list", async () => {
    render(
      await StoreProductList({
        listErrorMessage:
          "Could not load the store products. Please try again later.",
        locale: "en",
        products: [],
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
