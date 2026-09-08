// @vitest-environment jsdom

import { NextPageButton, ViewerProvider } from "@publira/comic-viewer";
import type { ViewerPage } from "@publira/comic-viewer";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EpisodeNeighborKeyNavigation } from "./episode-neighbor-key-navigation";

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// The tenant's default is `ja`, so an `en` reader's paths carry the prefix:
// what this asserts is that the key press lands on the same URL a link would.
vi.mock("#components/locale-provider", () => ({
  useLocale: () => "en",
  useTenantDefaultLocale: () => "ja",
}));

const copy = {
  nextHint: "Press the key again to open the next episode.",
  previousHint: "Press the key again to open the previous episode.",
};

const NEXT_HREF = "/series/SERIES_001/episodes/EPISODE_003";
const PREVIOUS_HREF = "/series/SERIES_001/episodes/EPISODE_001";

const buildPages = (pageCount: number): ViewerPage[] =>
  Array.from({ length: pageCount }, (_, index) => ({
    id: `page-${index + 1}`,
    src: `https://example.test/pages/${index + 1}.avif`,
    title: `Page ${index + 1}`,
  }));

/** Right to left, as the catalog is drawn: ArrowLeft is the next page. */
const renderViewer = (pageCount: number) =>
  render(
    <ViewerProvider
      initialReadingDirection="rtl"
      initialViewMode="single"
      pages={buildPages(pageCount)}
    >
      <NextPageButton>Next</NextPageButton>
      <EpisodeNeighborKeyNavigation
        copy={copy}
        nextHref={NEXT_HREF}
        previousHref={PREVIOUS_HREF}
      />
    </ViewerProvider>
  );

const pressForward = () => {
  fireEvent.keyDown(window, { key: "ArrowLeft" });
};

const pressBack = () => {
  fireEvent.keyDown(window, { key: "ArrowRight" });
};

/** The button names itself "Next page" through its own default aria-label. */
const turnPage = () => {
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
};

beforeEach(() => {
  mockPush.mockReset();
});

afterEach(cleanup);

describe("EpisodeNeighborKeyNavigation", () => {
  it("says what a second press will do rather than moving on the first", () => {
    renderViewer(1);
    pressForward();

    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe(copy.nextHint);
  });

  it("opens the next episode on the second press", () => {
    renderViewer(1);
    pressForward();
    pressForward();

    expect(mockPush).toHaveBeenCalledExactlyOnceWith(`/en${NEXT_HREF}`);
  });

  it("opens the previous episode from the first page", () => {
    renderViewer(2);
    pressBack();
    pressBack();

    expect(mockPush).toHaveBeenCalledExactlyOnceWith(`/en${PREVIOUS_HREF}`);
  });

  it("leaves the episode alone while pages are still left to turn", () => {
    renderViewer(3);
    turnPage();

    pressForward();
    pressForward();

    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("drops an armed key press once the reader turns a page", () => {
    renderViewer(2);
    // The first page is an end of its own: the previous episode is armed here.
    pressBack();
    turnPage();
    pressForward();

    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe(copy.nextHint);
  });

  it("ignores an arrow key typed into a control", () => {
    renderViewer(1);
    const textarea = document.createElement("textarea");
    document.body.append(textarea);

    fireEvent.keyDown(textarea, { key: "ArrowLeft" });
    fireEvent.keyDown(textarea, { key: "ArrowLeft" });

    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
    textarea.remove();
  });
});
