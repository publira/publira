// @vitest-environment jsdom

import {
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

const sendBeacon = vi.fn<(url: string, body: Blob) => boolean>();

/** The reader's own pairing rule: the cover stands alone. */
const SPREAD_START_INDEX = 1;

const episode: EpisodeDetail = {
  orderIndex: 1,
  price: 0,
  publicId: "EPISODE_001",
  publishedAt: "2026-08-01T00:00:00Z",
  readingPeriodHours: 0,
  scheduledAt: "",
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

const renderViewer = (initialPageIndex = 0) =>
  render(
    <ViewerProvider
      initialIndex={initialPageIndex}
      pages={buildPages(8)}
      spreadStartIndex={SPREAD_START_INDEX}
    >
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
const settle = () => {
  act(() => {
    vi.advanceTimersByTime(READING_POSITION_SAVE_DELAY_MS);
  });
};

const savedPageIndex = async (call: number): Promise<number> => {
  const [, body] = sendBeacon.mock.calls[call];
  const payload: unknown = JSON.parse(await body.text());
  return (payload as { pageIndex: number }).pageIndex;
};

beforeEach(() => {
  vi.useFakeTimers();
  // `clearMocks` drops the calls but keeps whatever a test taught the mock to
  // return, so a queue-refusing test would otherwise reach the next one.
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
    settle();

    expect(sendBeacon).toHaveBeenCalledOnce();
    expect(sendBeacon.mock.calls[0][0]).toBe(
      "/api/v1/series/SERIES_001/episodes/EPISODE_001/reading-position"
    );
    expect(sendBeacon.mock.calls[0][1].type).toBe("application/json");
    await expect(savedPageIndex(0)).resolves.toBe(1);
  });

  it("saves one page for a run of turns rather than one per turn", async () => {
    renderViewer();
    turnPage("Next page");
    turnPage("Next page");
    turnPage("Next page");
    settle();

    expect(sendBeacon).toHaveBeenCalledOnce();
    await expect(savedPageIndex(0)).resolves.toBe(3);
  });

  it("saves the page the reader is on when the page goes away", async () => {
    renderViewer();
    turnPage("Next page");
    fireEvent(window, new Event("pagehide"));

    expect(sendBeacon).toHaveBeenCalledOnce();
    await expect(savedPageIndex(0)).resolves.toBe(1);
  });

  it("saves the page the reader is on when they navigate away inside the app", async () => {
    const { unmount } = renderViewer();
    turnPage("Next page");
    unmount();

    expect(sendBeacon).toHaveBeenCalledOnce();
    await expect(savedPageIndex(0)).resolves.toBe(1);
  });

  it("saves the page a resumed reader opens on without a turn", async () => {
    renderViewer(4);
    settle();

    expect(sendBeacon).toHaveBeenCalledOnce();
    await expect(savedPageIndex(0)).resolves.toBe(4);
  });

  it("saves nothing more while the reader stays on the page it already saved", () => {
    renderViewer();
    turnPage("Next page");
    settle();
    turnPage("Previous page");
    turnPage("Next page");
    settle();

    expect(sendBeacon).toHaveBeenCalledOnce();
  });
});
