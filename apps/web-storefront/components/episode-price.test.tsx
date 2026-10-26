// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EpisodePrice } from "./episode-price";

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: string;
    values?: Record<string, string>;
  }) => (values?.date ? `${message} ${values.date}` : message),
}));

afterEach(cleanup);

const sellsEverywhere = { app: true, currency: "JPY", web: true };

describe("EpisodePrice", () => {
  it("Quote the price of an episode the web sells", () => {
    render(
      <EpisodePrice
        sales={sellsEverywhere}
        locale="en"
        price={1200}
        purchaseSurface="all"
      />
    );

    expect(screen.getByText("¥1,200")).toBeDefined();
  });

  it("Say that an episode sold in the app alone is sold there", () => {
    render(
      <EpisodePrice
        sales={sellsEverywhere}
        locale="en"
        price={1200}
        purchaseSurface="app"
      />
    );

    expect(screen.getByText("storefront.common.sold_in_app")).toBeDefined();
    expect(screen.queryByText("¥1,200")).toBeNull();
  });

  it("Quote the price of an episode sold in the app alone while the app cannot sell it", () => {
    render(
      <EpisodePrice
        sales={{ app: false, currency: "JPY", web: true }}
        locale="en"
        price={1200}
        purchaseSurface="app"
      />
    );

    expect(screen.getByText("¥1,200")).toBeDefined();
    expect(screen.queryByText("storefront.common.sold_in_app")).toBeNull();
  });

  it("Say that an episode sold on both is sold in the app while only the app can sell it", () => {
    render(
      <EpisodePrice
        locale="en"
        price={1200}
        purchaseSurface="all"
        sales={{ app: true, currency: "JPY", web: false }}
      />
    );

    expect(screen.getByText("storefront.common.sold_in_app")).toBeDefined();
    expect(screen.queryByText("¥1,200")).toBeNull();
  });

  it("Quote the price of an episode nobody can sell right now", () => {
    render(
      <EpisodePrice
        locale="en"
        price={1200}
        purchaseSurface="all"
        sales={{ app: false, currency: "JPY", web: false }}
      />
    );

    expect(screen.getByText("¥1,200")).toBeDefined();
  });

  it("Say until when a priced episode is free instead of quoting its price", () => {
    render(
      <EpisodePrice
        sales={sellsEverywhere}
        freeUntil="2026-10-11T14:59:00Z"
        locale="ja"
        price={1200}
        purchaseSurface="all"
        timeZone="Asia/Tokyo"
      />
    );

    expect(
      screen.getByText("storefront.common.free_until 10月11日(日) 23:59")
    ).toBeDefined();
    expect(screen.queryByText("¥1,200")).toBeNull();
  });

  it("Say only that a priced episode the free-after-publication rule opened is free", () => {
    render(
      <EpisodePrice
        sales={sellsEverywhere}
        freeUntil="9999-12-31T00:00:00Z"
        locale="en"
        price={1200}
        purchaseSurface="all"
        timeZone="Asia/Tokyo"
      />
    );

    expect(screen.getByText("storefront.common.free")).toBeDefined();
    expect(screen.queryByText(/storefront\.common\.free_until/u)).toBeNull();
    expect(screen.queryByText("¥1,200")).toBeNull();
  });

  it("Quote the price once no free reading period is open", () => {
    render(
      <EpisodePrice
        sales={sellsEverywhere}
        freeUntil={undefined}
        locale="en"
        price={1200}
        purchaseSurface="all"
        timeZone="Asia/Tokyo"
      />
    );

    expect(screen.getByText("¥1,200")).toBeDefined();
  });

  describe("an episode under a campaign", () => {
    const campaign = { endsAt: "2026-10-11T14:59:00Z", price: 800 };

    it("Quote the campaign price beside the regular one, and until when", () => {
      const { container } = render(
        <EpisodePrice
          campaign={campaign}
          locale="ja"
          price={1200}
          purchaseSurface="all"
          sales={sellsEverywhere}
          timeZone="Asia/Tokyo"
        />
      );

      expect(screen.getByText("￥800")).toBeDefined();
      expect(container.querySelector("s")?.textContent).toContain("￥1,200");
      expect(
        screen.getByText("storefront.common.campaign_until 10月11日(日) 23:59")
      ).toBeDefined();
    });

    it("Say until when it is free instead, while a free period is open over the campaign", () => {
      render(
        <EpisodePrice
          campaign={campaign}
          freeUntil="2026-10-11T14:59:00Z"
          locale="ja"
          price={1200}
          purchaseSurface="all"
          sales={sellsEverywhere}
          timeZone="Asia/Tokyo"
        />
      );

      expect(
        screen.getByText("storefront.common.free_until 10月11日(日) 23:59")
      ).toBeDefined();
      expect(screen.queryByText("￥800")).toBeNull();
    });

    it("Say that it is sold in the app rather than quote a price the web cannot take", () => {
      render(
        <EpisodePrice
          campaign={campaign}
          locale="ja"
          price={1200}
          purchaseSurface="app"
          sales={sellsEverywhere}
          timeZone="Asia/Tokyo"
        />
      );

      expect(screen.getByText("storefront.common.sold_in_app")).toBeDefined();
      expect(screen.queryByText("￥800")).toBeNull();
    });

    it("Call a neighbouring episode free when it is, whatever campaign it has", () => {
      render(
        <EpisodePrice
          campaign={campaign}
          locale="ja"
          price={0}
          purchaseSurface="all"
          sales={sellsEverywhere}
          timeZone="Asia/Tokyo"
        />
      );

      expect(screen.getByText("storefront.common.free")).toBeDefined();
    });
  });

  it("Quote the price in the tenant's currency, from its minor unit", () => {
    render(
      <EpisodePrice
        locale="en"
        price={499}
        purchaseSurface="all"
        sales={{ ...sellsEverywhere, currency: "USD" }}
      />
    );

    expect(screen.getByText("$4.99")).toBeDefined();
  });

  it("Quote no price while the tenant's currency is unknown", () => {
    const { container } = render(
      <EpisodePrice
        locale="en"
        price={1200}
        purchaseSurface="all"
        sales={{ app: false, currency: null, web: false }}
      />
    );

    expect(container.textContent).toBe("");
  });

  it("Call a free episode free wherever it is sold", () => {
    render(
      <EpisodePrice
        sales={sellsEverywhere}
        locale="en"
        price={0}
        purchaseSurface="app"
      />
    );

    expect(screen.getByText("storefront.common.free")).toBeDefined();
  });
});
