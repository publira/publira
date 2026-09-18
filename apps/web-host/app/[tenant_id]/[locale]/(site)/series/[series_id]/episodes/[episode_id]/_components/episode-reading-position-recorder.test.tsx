// @vitest-environment jsdom

import {
  EndPage,
  NextPageButton,
  PageStatus,
  PreviousPageButton,
  ViewerProvider,
} from "@publira/comic-viewer";
import type { ViewerPage } from "@publira/comic-viewer";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EpisodeDetail, EpisodeSeriesSummary } from "#lib/catalog";

import { READING_POSITION_SAVE_DELAY_MS } from "../_lib/reading-position";
import { EpisodeReadingPositionRecorder } from "./episode-reading-position-recorder";

const fetchMock = vi.fn<typeof fetch>();
const sendBeacon = vi.fn<(url: string, body: Blob) => boolean>();

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

const renderViewer = ({
  endPage = false,
  initialPageIndex = 0,
  spreadStartIndex = SPREAD_START_INDEX,
  viewMode = "single",
}: {
  endPage?: boolean;
  initialPageIndex?: number;
  spreadStartIndex?: number;
  viewMode?: "double" | "single";
} = {}) =>
  render(
    <ViewerProvider
      initialIndex={initialPageIndex}
      initialViewMode={viewMode}
      pages={buildPages(8)}
      spreadStartIndex={spreadStartIndex}
    >
      {endPage ? <EndPage>Leave a comment</EndPage> : null}
      <PreviousPageButton>Previous</PreviousPageButton>
      <NextPageButton>Next</NextPageButton>
      <PageStatus />
      <EpisodeReadingPositionRecorder episode={episode} series={series} />
    </ViewerProvider>
  );

const turnPage = (name: "Next page" | "Previous page") => {
  fireEvent.click(screen.getByRole("button", { name }));
};

/** The reader rests on the page they turned to for longer than the delay. */
const settle = async () => {
  await act(() => vi.advanceTimersByTimeAsync(READING_POSITION_SAVE_DELAY_MS));
};

const savedPageIndex = (call: number): number => {
  const [, init] = fetchMock.mock.calls[call];
  const payload: unknown = JSON.parse(String(init?.body));
  return (payload as { pageIndex: number }).pageIndex;
};

const beaconPageIndex = async (call: number): Promise<number> => {
  const [, body] = sendBeacon.mock.calls[call];
  const payload: unknown = JSON.parse(await body.text());
  return (payload as { pageIndex: number }).pageIndex;
};

beforeEach(() => {
  vi.useFakeTimers();
  // `clearMocks` drops the calls but keeps whatever a test taught the mock to
  // return, so a queue-refusing test would otherwise reach the next one.
  fetchMock.mockReset();
  fetchMock.mockImplementation(() =>
    Promise.resolve(new Response(null, { status: 204 }))
  );
  vi.stubGlobal("fetch", fetchMock);
  sendBeacon.mockReset();
  sendBeacon.mockReturnValue(true);
  vi.stubGlobal("navigator", { ...navigator, sendBeacon });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("EpisodeReadingPositionRecorder", () => {
  it("saves the page the reader settled on, addressed by the reader's own path", async () => {
    renderViewer();
    turnPage("Next page");
    await settle();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/v1/series/SERIES_001/episodes/EPISODE_001/reading-position"
    );
    expect(savedPageIndex(0)).toBe(1);
  });

  it("saves one page for a run of turns rather than one per turn", async () => {
    renderViewer();
    turnPage("Next page");
    turnPage("Next page");
    turnPage("Next page");
    await settle();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(savedPageIndex(0)).toBe(3);
  });

  it("hands the page the reader is on to the browser when the page goes away", async () => {
    renderViewer();
    turnPage("Next page");
    fireEvent(window, new Event("pagehide"));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendBeacon).toHaveBeenCalledOnce();
    await expect(beaconPageIndex(0)).resolves.toBe(1);
  });

  it("saves the page the reader is on when they navigate away inside the app", () => {
    const { unmount } = renderViewer();
    turnPage("Next page");
    unmount();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(savedPageIndex(0)).toBe(1);
  });

  it("saves the page a resumed reader opens on without a turn", async () => {
    renderViewer({ initialPageIndex: 4 });
    await settle();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(savedPageIndex(0)).toBe(4);
  });

  it("saves the last page of the episode for a reader on the page after it", async () => {
    renderViewer({ endPage: true, initialPageIndex: 7 });
    await settle();
    fetchMock.mockClear();

    turnPage("Next page");
    await settle();

    // The page after the last one belongs to the viewer rather than to the
    // episode, so the saved position stays where the episode ends.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("saves nothing more while the reader stays on the page it already saved", async () => {
    renderViewer();
    turnPage("Next page");
    await settle();
    turnPage("Previous page");
    turnPage("Next page");
    await settle();

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("saves the start of the spread when pairing begins on the first page", async () => {
    renderViewer({ spreadStartIndex: 0, viewMode: "double" });
    turnPage("Next page");
    await settle();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(savedPageIndex(0)).toBe(2);
  });

  it("saves the pages turned offline once the connection returns", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    renderViewer();
    turnPage("Next page");
    await settle();
    turnPage("Next page");
    turnPage("Next page");
    await settle();

    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(null, { status: 204 }))
    );
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(savedPageIndex(2)).toBe(3);
  });
});
