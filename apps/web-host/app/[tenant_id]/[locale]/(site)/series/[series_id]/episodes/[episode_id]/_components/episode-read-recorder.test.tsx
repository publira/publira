// @vitest-environment jsdom

import {
  NextPageButton,
  PageStatus,
  PreviousPageButton,
  useViewerContext,
  ViewerProvider,
} from "@publira/comic-viewer";
import type { ViewerPage, ViewMode } from "@publira/comic-viewer";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EpisodeDetail } from "#lib/catalog";

import { EpisodeReadRecorder } from "./episode-read-recorder";

const sendBeacon = vi.fn((_url: string, _body: Blob) => true);

/** The reader's own pairing rule: the cover stands alone (#356). */
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
  viewMode = "single",
}: {
  pageCount: number;
  viewMode?: ViewMode;
}) =>
  render(
    <ViewerProvider
      initialViewMode={viewMode}
      pages={buildPages(pageCount)}
      spreadStartIndex={SPREAD_START_INDEX}
    >
      <PreviousPageButton>Previous</PreviousPageButton>
      <NextPageButton>Next</NextPageButton>
      <GestureNavigation />
      <PageStatus />
      <EpisodeReadRecorder episode={episode} />
    </ViewerProvider>
  );

const turnPage = (name: "Next page" | "Previous page" | "Swipe forward") => {
  fireEvent.click(screen.getByRole("button", { name }));
};

const sentBody = async (call: number): Promise<unknown> => {
  const [, blob] = sendBeacon.mock.calls[call];
  return JSON.parse(await blob.text());
};

beforeEach(() => {
  vi.stubGlobal("navigator", { ...navigator, sendBeacon });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("EpisodeReadRecorder", () => {
  it("reports nothing while pages are still left to read", () => {
    renderViewer({ pageCount: 3 });
    turnPage("Next page");

    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it("reports the read when the next-page button reaches the last page", async () => {
    renderViewer({ pageCount: 3 });
    turnPage("Next page");
    turnPage("Next page");

    expect(sendBeacon).toHaveBeenCalledOnce();
    // The tenant comes from the segment the proxy rewrote, never the body.
    expect(sendBeacon.mock.calls[0][0]).toBe("/api/v1/episode-reads");
    await expect(sentBody(0)).resolves.toEqual({ publicId: "EPISODE_001" });
  });

  it("reports the read when a swipe reaches the last page", () => {
    renderViewer({ pageCount: 2 });
    turnPage("Swipe forward");

    expect(sendBeacon).toHaveBeenCalledOnce();
  });

  it("reports a spread that carries the last page", () => {
    // Five pages: the cover alone, then 2-3, then 4-5.
    renderViewer({ pageCount: 5, viewMode: "double" });
    turnPage("Next page");

    expect(screen.getByText("Pages 2-3 of 5")).toBeDefined();
    expect(sendBeacon).not.toHaveBeenCalled();

    turnPage("Next page");

    expect(screen.getByText("Pages 4-5 of 5")).toBeDefined();
    expect(sendBeacon).toHaveBeenCalledOnce();
  });

  it("reports a one-page episode without any page turn", () => {
    renderViewer({ pageCount: 1 });

    expect(sendBeacon).toHaveBeenCalledOnce();
  });

  it("sends nothing more once the read has been handed over", () => {
    renderViewer({ pageCount: 2 });
    turnPage("Next page");

    turnPage("Previous page");
    turnPage("Next page");

    expect(sendBeacon).toHaveBeenCalledOnce();
  });

  it("tries again the next time the reader reaches a last page the browser refused", () => {
    sendBeacon.mockReturnValueOnce(false);

    renderViewer({ pageCount: 2 });
    turnPage("Next page");

    turnPage("Previous page");
    turnPage("Next page");

    expect(sendBeacon).toHaveBeenCalledTimes(2);
  });

  it("leaves the reader turning pages when the browser cannot queue it", () => {
    sendBeacon.mockReturnValue(false);

    renderViewer({ pageCount: 2 });
    turnPage("Next page");

    expect(screen.getByText("Page 2 of 2")).toBeDefined();

    turnPage("Previous page");

    expect(screen.getByText("Page 1 of 2")).toBeDefined();
  });
});
