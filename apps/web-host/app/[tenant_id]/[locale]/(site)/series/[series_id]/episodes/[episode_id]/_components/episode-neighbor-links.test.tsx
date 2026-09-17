// @vitest-environment jsdom

import { ViewerProvider } from "@publira/comic-viewer";
import type { ReadingDirection } from "@publira/comic-viewer";
import { cleanup, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithClientMessages } from "#lib/render-with-client-messages";

import { EpisodeNeighborLinks } from "./episode-neighbor-links";

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

afterEach(cleanup);

const renderLinks = ({
  nextHref,
  previousHref,
  readingDirection = "rtl",
}: {
  nextHref?: string;
  previousHref?: string;
  readingDirection?: ReadingDirection;
}) =>
  renderWithClientMessages(
    <ViewerProvider
      initialReadingDirection={readingDirection}
      pages={[{ id: "page-1", src: "https://example.test/1.avif", title: "1" }]}
    >
      <EpisodeNeighborLinks nextHref={nextHref} previousHref={previousHref} />
    </ViewerProvider>
  );

describe("EpisodeNeighborLinks", () => {
  it("links to the episode on each side", async () => {
    await renderLinks({
      nextHref: "/series/SERIES_001/episodes/EPISODE_003",
      previousHref: "/series/SERIES_001/episodes/EPISODE_001",
    });

    expect(
      screen
        .getByRole("link", { name: "Previous episode" })
        .getAttribute("href")
    ).toBe("/series/SERIES_001/episodes/EPISODE_001");
    expect(
      screen.getByRole("link", { name: "Next episode" }).getAttribute("href")
    ).toBe("/series/SERIES_001/episodes/EPISODE_003");
    expect(
      screen.getByRole("navigation", { name: "Episode navigation" })
    ).toBeDefined();
  });

  it("leaves out the side the series has no episode on", async () => {
    await renderLinks({ nextHref: "/series/SERIES_001/episodes/EPISODE_002" });

    expect(screen.queryByRole("link", { name: "Previous episode" })).toBeNull();
    expect(screen.getByRole("link", { name: "Next episode" })).toBeDefined();
  });

  it("draws nothing at all for a series of one episode", async () => {
    await renderLinks({});

    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("puts each link on the side the page turn for the same direction is on", async () => {
    await renderLinks({
      nextHref: "/series/SERIES_001/episodes/EPISODE_003",
      previousHref: "/series/SERIES_001/episodes/EPISODE_001",
      readingDirection: "rtl",
    });

    // Right to left: the reader moves back towards the right edge.
    expect(
      screen.getByRole("link", { name: "Previous episode" }).className
    ).toContain("right-3");
    expect(
      screen.getByRole("link", { name: "Next episode" }).className
    ).toContain("left-3");

    cleanup();
    await renderLinks({
      nextHref: "/series/SERIES_001/episodes/EPISODE_003",
      previousHref: "/series/SERIES_001/episodes/EPISODE_001",
      readingDirection: "ltr",
    });

    expect(
      screen.getByRole("link", { name: "Previous episode" }).className
    ).toContain("left-3");
    expect(
      screen.getByRole("link", { name: "Next episode" }).className
    ).toContain("right-3");
  });
});
