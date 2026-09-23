// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
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
  }) => bindMessages(sharedCatalog("en"))(message, values),
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

// The shelf reads the catalogue and heads itself, both of which
// `related-series.test.tsx` covers; what this file asserts is which ending of
// the series carries one.
vi.mock("#components/related-series", () => ({
  RelatedSeries: ({ limit }: { limit: number }) => (
    <div data-limit={limit} data-testid="related-series" />
  ),
  RelatedSeriesSkeleton: () => null,
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

// The share control resolves the tenant's own origin, which
// `share-menu.test.tsx` and `tenant-locale-path.test.ts` cover between them;
// what this file asserts is which page it is offered on and for what.
vi.mock("#components/share-control", () => ({
  ShareControl: ({
    path,
    text,
    title,
  }: {
    path: string;
    text: string;
    title: string;
  }) => (
    <button data-path={path} data-text={text} type="button">
      {`Share ${title}`}
    </button>
  ),
}));

afterEach(cleanup);

const episode: EpisodeDetail = {
  credits: [],
  orderIndex: 2,
  price: 0,
  publicId: "EPISODE_002",
  publishedAt: "2026-08-01T00:00:00Z",
  purchaseSurface: "all",
  ratingCount: 0,
  readingDirection: "rtl",
  readingPeriodHours: 0,
  scheduledAt: "",
  spreadStartIndex: 1,
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
  purchaseSurface: "all",
  title: "Third light",
};

const previousEpisode: EpisodeNeighborItem = {
  isFree: true,
  orderIndex: 1,
  price: 0,
  publicId: "EPISODE_001",
  purchaseSurface: "all",
  title: "First light",
};

const renderPanel = async ({
  neighbor,
  previousNeighbor,
}: {
  neighbor?: EpisodeNeighborItem;
  previousNeighbor?: EpisodeNeighborItem;
} = {}) =>
  render(
    await EpisodeEndPanel({
      episode,
      nextEpisode: neighbor,
      previousEpisode: previousNeighbor,
      series,
      shareText: "Long nights by Nightly Author",
      shareTitle: "Episode 2 Second light",
      tenantId: "TENANT_001",
    })
  );

describe("EpisodeEndPanel", () => {
  it("lists the episodes either side of this one as rows", async () => {
    await renderPanel({
      neighbor: nextEpisode,
      previousNeighbor: previousEpisode,
    });

    expect(
      screen.getByRole("heading", { name: "More episodes" })
    ).toBeDefined();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(
      screen.getByRole("link", { name: /Third light/u }).getAttribute("href")
    ).toBe("/series/SERIES_001/episodes/EPISODE_003");
    expect(
      screen.getByRole("link", { name: /First light/u }).getAttribute("href")
    ).toBe("/series/SERIES_001/episodes/EPISODE_001");
    expect(screen.getByText("Episode 3")).toBeDefined();
    expect(screen.getByText("Episode 1")).toBeDefined();
  });

  it("offers to pass this episode on, whichever episode it is", async () => {
    await renderPanel({
      neighbor: nextEpisode,
      previousNeighbor: previousEpisode,
    });

    const share = screen.getByRole("button", {
      name: "Share Episode 2 Second light",
    });
    expect(
      share.dataset.path,
      "the share control hands over this episode's own page"
    ).toBe("/series/SERIES_001/episodes/EPISODE_002");
    expect(
      share.dataset.text,
      "and says in words which work the reader is passing on"
    ).toBe("Long nights by Nightly Author");
  });

  it("names the price of a paid next episode rather than calling it free", async () => {
    await renderPanel({
      neighbor: { ...nextEpisode, isFree: false, price: 500 },
    });

    expect(screen.getByText("¥500")).toBeDefined();
    expect(screen.queryByText("Free")).toBeNull();
  });

  it("keeps a free window free even where the episode carries a price", async () => {
    await renderPanel({
      neighbor: { ...nextEpisode, isFree: true, price: 500 },
    });

    expect(screen.getByText("Free")).toBeDefined();
  });

  it("says a paid neighbour sold in the app alone is sold there, on either side", async () => {
    await renderPanel({
      neighbor: {
        ...nextEpisode,
        isFree: false,
        price: 500,
        purchaseSurface: "app",
      },
      previousNeighbor: {
        ...previousEpisode,
        isFree: false,
        price: 300,
        purchaseSurface: "app",
      },
    });

    expect(
      screen.getByRole("link", { name: /Third light/u }).textContent
    ).toContain("Sold in the app");
    expect(
      screen.getByRole("link", { name: /First light/u }).textContent
    ).toContain("Sold in the app");
    expect(screen.queryByText("¥500")).toBeNull();
    expect(screen.queryByText("¥300")).toBeNull();
  });

  it("names the price of a paid neighbour sold on the web", async () => {
    await renderPanel({
      neighbor: {
        ...nextEpisode,
        isFree: false,
        price: 500,
        purchaseSurface: "web",
      },
    });

    expect(screen.getByText("¥500")).toBeDefined();
    expect(screen.queryByText("Sold in the app")).toBeNull();
  });

  it("keeps a free neighbour free wherever it is sold", async () => {
    await renderPanel({
      neighbor: {
        ...nextEpisode,
        isFree: true,
        price: 500,
        purchaseSurface: "app",
      },
    });

    expect(screen.getByText("Free")).toBeDefined();
    expect(screen.queryByText("Sold in the app")).toBeNull();
  });

  it("says the reader is up to date on the last episode, and offers to follow", async () => {
    await renderPanel({ previousNeighbor: previousEpisode });

    expect(
      screen.getByRole("heading", { name: "You are up to date" })
    ).toBeDefined();
    expect(screen.getByText(/Long nights/u)).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Follow" }).dataset.returnTo
    ).toBe("/series/SERIES_001/episodes/EPISODE_002");
  });

  it("suggests other works once the series has run out", async () => {
    await renderPanel();

    expect(screen.getByTestId("related-series").dataset.limit).toBe("3");
  });

  it("keeps the next episode the only offer while there is one", async () => {
    await renderPanel({ neighbor: nextEpisode });

    expect(screen.queryByTestId("related-series")).toBeNull();
  });

  it("always leads back to the series", async () => {
    await renderPanel({ neighbor: nextEpisode });

    expect(
      screen
        .getByRole("link", { name: "Back to the series" })
        .getAttribute("href")
    ).toBe("/series/SERIES_001");
  });
});
