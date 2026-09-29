// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EpisodePrice } from "./episode-price";

vi.mock("#components/message", () => ({
  Message: ({ message }: { message: string }) => message,
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

  it("Call a free episode free wherever it is sold", () => {
    render(<EpisodePrice locale="en" price={0} purchaseSurface="app" />);

    expect(screen.getByText("host.common.free")).toBeDefined();
  });
});
