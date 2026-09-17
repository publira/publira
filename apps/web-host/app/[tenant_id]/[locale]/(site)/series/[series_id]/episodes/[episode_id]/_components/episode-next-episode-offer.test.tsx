// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EpisodeNeighborItem, EpisodeSeriesSummary } from "#lib/catalog";

import { EpisodeNextEpisodeOffer } from "./episode-next-episode-offer";

// `<Message>` and `getLocale()` are async Server Components / root-parameter
// reads that only the Next.js compiler can provide. The catalog is the real
// one, so the assertions stay on the copy a reader actually sees.
vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"))(message, values),
}));

vi.mock("#lib/locale", () => ({
  getLocale: () => Promise.resolve("en"),
}));

vi.mock("#components/locale-provider", () => ({
  useLocale: () => "en",
  useTenantDefaultLocale: () => "en",
}));

vi.mock("next/link", () => ({
  default: ({ children, className, href }: React.ComponentProps<"a">) => (
    <a className={className} href={href}>
      {children}
    </a>
  ),
}));

// The follow control reads the reader's own session, which this file is not
// about; what it asserts is that the last episode offers one at all.
vi.mock("#components/follow-control", () => ({
  FollowControl: ({ returnTo }: { returnTo: string }) => (
    <button data-return-to={returnTo} type="button">
      Follow
    </button>
  ),
}));

afterEach(cleanup);

const series: EpisodeSeriesSummary = {
  publicId: "SERIES_001",
  title: "Long nights",
};

const nextEpisode: EpisodeNeighborItem = {
  isFree: true,
  orderIndex: 3,
  price: 0,
  publicId: "EPISODE_003",
  title: "Third light",
};

const renderOffer = async (neighbor?: EpisodeNeighborItem) =>
  render(
    await EpisodeNextEpisodeOffer({
      episodePublicId: "EPISODE_002",
      nextEpisode: neighbor,
      series,
      tenantId: "TENANT_001",
    })
  );

describe("EpisodeNextEpisodeOffer", () => {
  it("links to the next episode with its number, title, and price", async () => {
    await renderOffer(nextEpisode);

    const link = screen.getByRole("link", { name: /Next episode/u });
    expect(link.getAttribute("href")).toBe(
      "/series/SERIES_001/episodes/EPISODE_003"
    );
    expect(link.textContent).toContain("Episode 3");
    expect(link.textContent).toContain("Third light");
    expect(link.textContent).toContain("Free");
    expect(
      screen.queryByRole("heading", { name: "You are up to date" }),
      "a reader with an episode still to read has not caught up"
    ).toBeNull();
  });

  it("names the price of a paid next episode", async () => {
    await renderOffer({ ...nextEpisode, isFree: false, price: 500 });

    const link = screen.getByRole("link", { name: /Next episode/u });
    expect(link.textContent).toContain("¥500");
    expect(link.textContent).not.toContain("Free");
  });

  it("keeps the control on the last episode, disabled but still focusable", async () => {
    await renderOffer();

    expect(screen.queryByRole("link")).toBeNull();
    const control = screen.getByRole("button", { name: "Next episode" });
    expect(control.getAttribute("aria-disabled")).toBe("true");
    expect(
      control.hasAttribute("disabled"),
      "a native disabled attribute would take it out of the tab order"
    ).toBe(false);
  });

  it("says the reader is up to date on the last episode, and offers to follow", async () => {
    await renderOffer();

    expect(
      screen.getByRole("heading", { name: "You are up to date" })
    ).toBeDefined();
    expect(screen.getByText(/Long nights/u)).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Follow" }).dataset.returnTo
    ).toBe("/series/SERIES_001/episodes/EPISODE_002");
  });
});
