// @vitest-environment jsdom

import { getMessage } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  EpisodeDetail,
  EpisodeNeighborItem,
  EpisodeSeriesSummary,
} from "#lib/catalog";

import { EpisodeEndPanel } from "./episode-end-panel";

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
  }) => getMessage(sharedCatalog("en"), message, values),
}));

vi.mock("#lib/locale", () => ({
  getLocale: () => Promise.resolve("en"),
  loadHostMessages: () => Promise.resolve(sharedCatalog("en")),
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

const episode: EpisodeDetail = {
  orderIndex: 2,
  price: 0,
  publicId: "EPISODE_002",
  publishedAt: "2026-08-01T00:00:00Z",
  readingPeriodHours: 0,
  scheduledAt: "",
  status: "published",
  title: "Second light",
};

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

const renderPanel = async (neighbor?: EpisodeNeighborItem) =>
  render(
    await EpisodeEndPanel({
      episode,
      nextEpisode: neighbor,
      series,
      tenantId: "TENANT_001",
    })
  );

describe("EpisodeEndPanel", () => {
  it("offers the next episode as one link, with what it costs beside it", async () => {
    await renderPanel(nextEpisode);

    expect(
      screen.getByRole("link", { name: "Third light" }).getAttribute("href")
    ).toBe("/series/SERIES_001/episodes/EPISODE_003");
    expect(screen.getByRole("heading", { name: "Up next" })).toBeDefined();
    expect(screen.getByText("Free")).toBeDefined();
    expect(screen.getByText("#3")).toBeDefined();
  });

  it("names the price of a paid next episode rather than calling it free", async () => {
    await renderPanel({
      ...nextEpisode,
      isFree: false,
      price: 500,
    });

    expect(screen.getByText("¥500")).toBeDefined();
    expect(screen.queryByText("Free")).toBeNull();
  });

  it("keeps a free window free even where the episode carries a price", async () => {
    await renderPanel({ ...nextEpisode, isFree: true, price: 500 });

    expect(screen.getByText("Free")).toBeDefined();
  });

  it("says the reader is up to date on the last episode, and offers to follow", async () => {
    await renderPanel();

    expect(
      screen.getByRole("heading", { name: "You are up to date" })
    ).toBeDefined();
    expect(screen.getByText(/Long nights/u)).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Follow" }).dataset.returnTo
    ).toBe("/series/SERIES_001/episodes/EPISODE_002");
  });

  it("always leads back to the series", async () => {
    await renderPanel(nextEpisode);

    expect(
      screen
        .getByRole("link", { name: "Back to the series" })
        .getAttribute("href")
    ).toBe("/series/SERIES_001");
  });
});
