// @vitest-environment jsdom

import {
  NextPageButton,
  PageStatus,
  PreviousPageButton,
  useViewerContext,
  ViewerProvider,
} from "@publira/comic-viewer";
import type { ViewerPage, ViewMode } from "@publira/comic-viewer";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EpisodeReadRecorder } from "./episode-read-recorder";

const { mockMarkEpisodeAsReadAction } = vi.hoisted(() => ({
  mockMarkEpisodeAsReadAction: vi.fn(),
}));

vi.mock("../_lib/actions", () => ({
  markEpisodeAsReadAction: mockMarkEpisodeAsReadAction,
}));

/** The reader's own pairing rule: the cover stands alone (#356). */
const SPREAD_START_INDEX = 1;

const episodePublicId = "EPISODE_001";
const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

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
      <EpisodeReadRecorder
        episodePublicId={episodePublicId}
        tenantId={tenantId}
      />
    </ViewerProvider>
  );

const turnPage = (name: "Next page" | "Previous page" | "Swipe forward") => {
  fireEvent.click(screen.getByRole("button", { name }));
};

/**
 * Lets every attempt started so far settle, so the next page turn sees the
 * suppression state the finished attempt left behind.
 */
const settleAttempts = async (): Promise<void> => {
  await Promise.allSettled(
    mockMarkEpisodeAsReadAction.mock.results.map((result) => result.value)
  );
};

beforeEach(() => {
  mockMarkEpisodeAsReadAction.mockResolvedValue(true);
});

afterEach(cleanup);

describe("EpisodeReadRecorder", () => {
  it("records nothing while pages are still left to read", () => {
    renderViewer({ pageCount: 3 });
    turnPage("Next page");

    expect(mockMarkEpisodeAsReadAction).not.toHaveBeenCalled();
  });

  it("records the read when the next-page button reaches the last page", () => {
    renderViewer({ pageCount: 3 });
    turnPage("Next page");
    turnPage("Next page");

    expect(mockMarkEpisodeAsReadAction).toHaveBeenCalledExactlyOnceWith({
      episodePublicId,
      tenantId,
    });
  });

  it("records the read when a swipe reaches the last page", () => {
    renderViewer({ pageCount: 2 });
    turnPage("Swipe forward");

    expect(mockMarkEpisodeAsReadAction).toHaveBeenCalledExactlyOnceWith({
      episodePublicId,
      tenantId,
    });
  });

  it("records a spread that carries the last page", () => {
    // Five pages: the cover alone, then 2-3, then 4-5.
    renderViewer({ pageCount: 5, viewMode: "double" });
    turnPage("Next page");

    expect(screen.getByText("Pages 2-3 of 5")).toBeDefined();
    expect(mockMarkEpisodeAsReadAction).not.toHaveBeenCalled();

    turnPage("Next page");

    expect(screen.getByText("Pages 4-5 of 5")).toBeDefined();
    expect(mockMarkEpisodeAsReadAction).toHaveBeenCalledOnce();
  });

  it("records a one-page episode without any page turn", () => {
    renderViewer({ pageCount: 1 });

    expect(mockMarkEpisodeAsReadAction).toHaveBeenCalledExactlyOnceWith({
      episodePublicId,
      tenantId,
    });
  });

  it("sends nothing more once the read stands", async () => {
    renderViewer({ pageCount: 2 });
    turnPage("Next page");
    await settleAttempts();

    turnPage("Previous page");
    turnPage("Next page");

    expect(mockMarkEpisodeAsReadAction).toHaveBeenCalledOnce();
  });

  it("tries again the next time the reader reaches the last page", async () => {
    mockMarkEpisodeAsReadAction.mockResolvedValueOnce(false);

    renderViewer({ pageCount: 2 });
    turnPage("Next page");
    await settleAttempts();

    turnPage("Previous page");
    turnPage("Next page");

    expect(mockMarkEpisodeAsReadAction).toHaveBeenCalledTimes(2);
  });

  it("takes up an arrival that landed while a failing attempt was in flight", async () => {
    const attempt = Promise.withResolvers<boolean>();
    mockMarkEpisodeAsReadAction.mockReturnValueOnce(attempt.promise);

    renderViewer({ pageCount: 2 });
    turnPage("Next page");

    expect(mockMarkEpisodeAsReadAction).toHaveBeenCalledOnce();

    // The reader turns back and returns before the first attempt settles.
    turnPage("Previous page");
    turnPage("Next page");

    expect(mockMarkEpisodeAsReadAction).toHaveBeenCalledOnce();

    attempt.resolve(false);
    await act(async () => {
      await attempt.promise;
    });

    expect(mockMarkEpisodeAsReadAction).toHaveBeenCalledTimes(2);
  });

  it("leaves the reader turning pages when recording throws", async () => {
    mockMarkEpisodeAsReadAction.mockRejectedValueOnce(new Error("unreachable"));

    renderViewer({ pageCount: 2 });
    turnPage("Next page");
    await settleAttempts();

    expect(screen.getByText("Page 2 of 2")).toBeDefined();

    turnPage("Previous page");

    expect(screen.getByText("Page 1 of 2")).toBeDefined();

    turnPage("Next page");

    expect(mockMarkEpisodeAsReadAction).toHaveBeenCalledTimes(2);
  });
});
