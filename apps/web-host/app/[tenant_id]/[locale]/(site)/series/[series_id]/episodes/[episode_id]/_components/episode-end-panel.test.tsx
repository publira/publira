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

// Same for the reaction control: this file asserts that the panel offers one,
// not how the private score is read.
vi.mock("#components/episode-reaction-control", () => ({
  EpisodeReactionControl: ({
    ratingCount,
    returnTo,
  }: {
    ratingCount: number;
    returnTo: string;
  }) => (
    <button
      data-rating-count={ratingCount}
      data-return-to={returnTo}
      type="button"
    >
      React
    </button>
  ),
}));

afterEach(cleanup);

const episode: EpisodeDetail = {
  orderIndex: 2,
  price: 0,
  publicId: "EPISODE_002",
  publishedAt: "2026-08-01T00:00:00Z",
  ratingCount: 0,
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

const previousEpisode: EpisodeNeighborItem = {
  isFree: true,
  orderIndex: 1,
  price: 0,
  publicId: "EPISODE_001",
  title: "First light",
};

const renderPanel = async ({
  marksNextEpisode = true,
  neighbor,
  previousNeighbor,
}: {
  marksNextEpisode?: boolean;
  neighbor?: EpisodeNeighborItem;
  previousNeighbor?: EpisodeNeighborItem;
} = {}) =>
  render(
    await EpisodeEndPanel({
      episode,
      marksNextEpisode,
      nextEpisode: neighbor,
      previousEpisode: previousNeighbor,
      series,
      tenantId: "TENANT_001",
    })
  );

/** The Shu dot, which is a drawing rather than something to read out. */
const readingMarks = (container: HTMLElement) =>
  container.querySelectorAll(".bg-secondary");

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

  it("marks the next episode alone, so the page keeps one Shu", async () => {
    const { container } = await renderPanel({
      neighbor: nextEpisode,
      previousNeighbor: previousEpisode,
    });

    const marks = readingMarks(container);
    expect(marks).toHaveLength(1);
    expect(
      marks[0]?.closest("a")?.getAttribute("href"),
      "the mark sits on the row that opens the next episode"
    ).toBe("/series/SERIES_001/episodes/EPISODE_003");
  });

  // A gated episode spends its Shu on the action that opens the body, so the
  // row below carries none.
  it("leaves the next episode unmarked where the body is not open", async () => {
    const { container } = await renderPanel({
      marksNextEpisode: false,
      neighbor: nextEpisode,
    });

    expect(readingMarks(container)).toHaveLength(0);
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

  it("offers a reaction control on every ending, with the cached headcount", async () => {
    await renderPanel({ neighbor: nextEpisode });

    const control = screen.getByRole("button", { name: "React" });
    expect(control.dataset.returnTo).toBe(
      "/series/SERIES_001/episodes/EPISODE_002"
    );
    expect(control.dataset.ratingCount).toBe("0");
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
