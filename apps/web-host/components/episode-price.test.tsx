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

describe("EpisodePrice", () => {
  it("Quote the price of an episode the web sells", () => {
    render(<EpisodePrice locale="en" price={1200} purchaseSurface="all" />);

    expect(screen.getByText("¥1,200")).toBeDefined();
  });

  it("Say that an episode sold in the app alone is sold there", () => {
    render(<EpisodePrice locale="en" price={1200} purchaseSurface="app" />);

    expect(screen.getByText("host.common.sold_in_app")).toBeDefined();
    expect(screen.queryByText("¥1,200")).toBeNull();
  });

  it("Say until when a priced episode is free instead of quoting its price", () => {
    render(
      <EpisodePrice
        freeUntil="2026-10-11T14:59:00Z"
        locale="ja"
        price={1200}
        purchaseSurface="all"
        timeZone="Asia/Tokyo"
      />
    );

    expect(
      screen.getByText("host.common.free_until 10月11日(日) 23:59")
    ).toBeDefined();
    expect(screen.queryByText("¥1,200")).toBeNull();
  });

  it("Quote the price once no free reading period is open", () => {
    render(
      <EpisodePrice
        freeUntil={undefined}
        locale="en"
        price={1200}
        purchaseSurface="all"
        timeZone="Asia/Tokyo"
      />
    );

    expect(screen.getByText("¥1,200")).toBeDefined();
  });

  it("Call a free episode free wherever it is sold", () => {
    render(<EpisodePrice locale="en" price={0} purchaseSurface="app" />);

    expect(screen.getByText("host.common.free")).toBeDefined();
  });
});
