// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CampaignPrice } from "./campaign-price";

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

/** 23:59 on Sunday 11 October in Tokyo, and 07:59 that morning in Los Angeles. */
const campaign = { endsAt: "2026-10-11T14:59:00Z", price: 800 };

describe("CampaignPrice", () => {
  it("Quotes the campaign price, with the regular one struck through and named for a screen reader", () => {
    const { container } = render(
      <CampaignPrice
        campaign={campaign}
        currency="USD"
        locale="en"
        price={1200}
        timeZone="Asia/Tokyo"
      />
    );

    expect(screen.getByText("$8.00")).toBeDefined();
    const regular = container.querySelector("s");
    expect(regular?.textContent).toBe("storefront.common.regular_price $12.00");
    expect(regular?.querySelector(".sr-only")?.textContent).toBe(
      "storefront.common.regular_price "
    );
  });

  it("Writes the end of the campaign in the tenant's time zone", () => {
    const { rerender } = render(
      <CampaignPrice
        campaign={campaign}
        currency="JPY"
        locale="ja"
        price={1200}
        timeZone="Asia/Tokyo"
      />
    );

    expect(
      screen.getByText("storefront.common.campaign_until 10月11日(日) 23:59")
    ).toBeDefined();

    rerender(
      <CampaignPrice
        campaign={campaign}
        currency="JPY"
        locale="ja"
        price={1200}
        timeZone="America/Los_Angeles"
      />
    );

    expect(
      screen.getByText("storefront.common.campaign_until 10月11日(日) 7:59")
    ).toBeDefined();
  });

  it("Marks the end up as a machine-readable instant", () => {
    const { container } = render(
      <CampaignPrice
        campaign={campaign}
        currency="JPY"
        locale="en"
        price={1200}
        timeZone="Asia/Tokyo"
      />
    );

    expect(container.querySelector("time")?.getAttribute("datetime")).toBe(
      campaign.endsAt
    );
  });
});
