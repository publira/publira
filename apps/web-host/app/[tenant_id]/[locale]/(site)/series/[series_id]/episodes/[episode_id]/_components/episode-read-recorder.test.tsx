// @vitest-environment jsdom

import { setTimeout as delay } from "node:timers/promises";

import {
  NextPageButton,
  PageStatus,
  PreviousPageButton,
  useViewerContext,
  ViewerProvider,
} from "@publira/comic-viewer";
import type { ViewerPage, ViewMode } from "@publira/comic-viewer";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EpisodeDetail, EpisodeSeriesSummary } from "#lib/catalog";

import { EpisodeReadRecorder } from "./episode-read-recorder";

const fetchMock = vi.fn<typeof fetch>();

const delivered = () => Promise.resolve(new Response(null, { status: 204 }));

/** The reader's own pairing rule: the cover stands alone. */
const SPREAD_START_INDEX = 1;

const episode: EpisodeDetail = {
  credits: [],
  orderIndex: 1,
  price: 0,
  publicId: "EPISODE_001",
  publishedAt: "2026-08-01T00:00:00Z",
  ratingCount: 0,
  readingDirection: "rtl",
  readingPeriodHours: 0,
  scheduledAt: "",
  spreadStartIndex: 1,
  status: "published",
  title: "First light",
};

const series: EpisodeSeriesSummary = {
  publicId: "SERIES_001",
  title: "Long nights",
};

const buildPages = (pageCount: number): ViewerPage[] =>
  Array.from({ length: pageCount }, (_, index) => ({
    id: `page-${index + 1}`,
    src: `https://example.test/pages/${index + 1}.avif`,
    title: `Page ${index + 1}`,
  }));

/**
 * Stands in for the page turns a button click cannot reproduce here: the arrow
 * keys and a swipe are handled by the viewport, which needs a layout jsdom has
 * none of, and both end up calling the `goToNext` this exposes.
 */
const GestureNavigation = () => {
  const { goToNext } = useViewerContext();

  return (
    <button
      onClick={() => {
        goToNext();
      }}
      type="button"
    >
      Swipe forward
    </button>
  );
};

const renderViewer = ({
  pageCount,
  spreadStartIndex = SPREAD_START_INDEX,
  viewMode = "single",
}: {
  pageCount: number;
  spreadStartIndex?: number;
  viewMode?: ViewMode;
}) =>
  render(
    <ViewerProvider
      initialViewMode={viewMode}
      pages={buildPages(pageCount)}
      spreadStartIndex={spreadStartIndex}
    >
      <PreviousPageButton>Previous</PreviousPageButton>
      <NextPageButton>Next</NextPageButton>
      <GestureNavigation />
      <PageStatus />
      <EpisodeReadRecorder episode={episode} series={series} />
    </ViewerProvider>
  );

const turnPage = (name: "Next page" | "Previous page" | "Swipe forward") => {
  fireEvent.click(screen.getByRole("button", { name }));
};

/** Lets a send that already settled report back to the recorder. */
const settleSends = async () => {
  await act(() => delay(0));
};

beforeEach(() => {
  // `clearMocks` drops the calls but keeps whatever a test taught the mock to
  // return, so the failing-send tests would otherwise reach the next one.
  fetchMock.mockReset();
  fetchMock.mockImplementation(delivered);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("EpisodeReadRecorder", () => {
  it("reports nothing while pages are still left to read", () => {
    renderViewer({ pageCount: 3 });
    turnPage("Next page");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports the read when the next-page button reaches the last page", () => {
    renderViewer({ pageCount: 3 });
    turnPage("Next page");
    turnPage("Next page");

    expect(fetchMock).toHaveBeenCalledOnce();
    // The episode is named by the path, and the tenant by the segment the
    // proxy rewrote in front of it.
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/v1/series/SERIES_001/episodes/EPISODE_001/read"
    );
  });

  it("reports the read when a swipe reaches the last page", () => {
    renderViewer({ pageCount: 2 });
    turnPage("Swipe forward");

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("reports a spread that carries the last page", () => {
    // Five pages: the cover alone, then 2-3, then 4-5.
    renderViewer({ pageCount: 5, viewMode: "double" });
    turnPage("Next page");

    expect(screen.getByText("Pages 2-3 of 5")).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();

    turnPage("Next page");

    expect(screen.getByText("Pages 4-5 of 5")).toBeDefined();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("shows both pages of a first-page pair on the opening screen", () => {
    renderViewer({ pageCount: 4, spreadStartIndex: 0, viewMode: "double" });

    expect(screen.getByText("Pages 1-2 of 4")).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a two-page episode that pairs from its first page without a turn", () => {
    renderViewer({ pageCount: 2, spreadStartIndex: 0, viewMode: "double" });

    expect(screen.getByText("Pages 1-2 of 2")).toBeDefined();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("reports a one-page episode without any page turn", () => {
    renderViewer({ pageCount: 1 });

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("sends nothing more once the read has been delivered", async () => {
    renderViewer({ pageCount: 2 });
    turnPage("Next page");
    await settleSends();

    turnPage("Previous page");
    turnPage("Next page");

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("sends nothing more while the read is still in flight", () => {
    fetchMock.mockReturnValue(Promise.withResolvers<Response>().promise);

    renderViewer({ pageCount: 2 });
    turnPage("Next page");
    turnPage("Previous page");
    turnPage("Next page");

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("tries again the next time the reader reaches a last page that was not delivered", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    renderViewer({ pageCount: 2 });
    turnPage("Next page");
    await settleSends();

    turnPage("Previous page");
    turnPage("Next page");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports a read made offline once the connection returns, with no reader action", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    renderViewer({ pageCount: 2 });
    turnPage("Next page");
    await settleSends();
    turnPage("Previous page");

    fireEvent(window, new Event("online"));
    await settleSends();
    fireEvent(window, new Event("online"));

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("leaves the reader turning pages when the read cannot be delivered", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    renderViewer({ pageCount: 2 });
    turnPage("Next page");
    await settleSends();

    expect(screen.getByText("Page 2 of 2")).toBeDefined();

    turnPage("Previous page");

    expect(screen.getByText("Page 1 of 2")).toBeDefined();
  });
});
