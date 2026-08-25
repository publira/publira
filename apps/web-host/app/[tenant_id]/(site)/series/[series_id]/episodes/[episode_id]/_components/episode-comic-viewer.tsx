"use client";

import {
  NextPageButton,
  PageCanvas,
  PageNavigation,
  PageProgress,
  PageProgressTrack,
  PageStatus,
  PreviousPageButton,
  Root as ComicViewerRoot,
  Toolbar,
  usePageLoadState,
  useViewerContext,
  Viewport,
  ViewportPage,
} from "@publira/comic-viewer";
import type { PageStatusProps, ViewerPage } from "@publira/comic-viewer";

import "@publira/comic-viewer/core.css";
import { ChevronLeftIcon, ChevronRightIcon } from "@publira/icons";
import { useCallback, useRef, useSyncExternalStore } from "react";

import {
  CONTROL_BUTTON_CLASS,
  PageFitControl,
  ReadingDirectionControl,
} from "./viewer-controls";

const formatPageStatus: NonNullable<PageStatusProps["format"]> = ({
  firstPage,
  lastPage,
  pageCount,
}) => {
  if (pageCount === 0) {
    return "ページがありません";
  }

  return firstPage === lastPage
    ? `${firstPage} / ${pageCount}ページ`
    : `${firstPage}–${lastPage} / ${pageCount}ページ`;
};

const subscribeToFullscreen = (onStoreChange: () => void) => {
  document.addEventListener("fullscreenchange", onStoreChange);

  return () => {
    document.removeEventListener("fullscreenchange", onStoreChange);
  };
};

const isFullscreenOpen = () => document.fullscreenElement !== null;

const isFullscreenAvailable = () => document.fullscreenEnabled;

/** Neither is knowable while rendering on the server. */
const isFalseOnServer = () => false;

/**
 * The page template the viewport renders for every managed page. It keeps the
 * canvas the viewer draws into and adds the states the canvas cannot show on
 * its own: a page that has nothing on screen yet, and a page whose fetch or
 * decode failed and needs the reader to ask for another attempt.
 */
const ViewerPageTemplate = () => {
  const { placeholder, retry, status } = usePageLoadState();

  return (
    <ViewportPage className="relative">
      <PageCanvas />
      {status === "loading" && !placeholder ? (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-neutral-400">
          読み込み中…
        </p>
      ) : null}
      {status === "error" ? (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-950/85 px-6 text-center"
          role="alert"
        >
          <p className="text-sm text-neutral-200">
            このページを読み込めませんでした。
          </p>
          <button
            className="rounded-full border border-neutral-500 px-4 py-1.5 text-sm font-medium text-neutral-100 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-100"
            onClick={retry}
            type="button"
          >
            再読み込み
          </button>
        </div>
      ) : null}
    </ViewportPage>
  );
};

/**
 * The controls that stay on screen. The page-turn controls inside the viewport
 * fade out while the reader is still, so the way back out of fullscreen and the
 * settings that decide how a page is laid out must not share that visibility.
 */
const ViewerControlBar = ({
  episodeTitle,
  onToggleFullscreen,
}: {
  episodeTitle: string;
  onToggleFullscreen: () => void;
}) => {
  const isFullscreen = useSyncExternalStore(
    subscribeToFullscreen,
    isFullscreenOpen,
    isFalseOnServer
  );
  const canGoFullscreen = useSyncExternalStore(
    subscribeToFullscreen,
    isFullscreenAvailable,
    isFalseOnServer
  );

  return (
    /* The title takes a row of its own until the viewport is wide enough to
       hold it beside the controls, so a narrow screen wraps at a chosen place
       rather than splitting a segmented control down the middle. */
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/10 bg-black/40 px-3 py-2">
      <p className="min-w-0 flex-1 basis-full truncate text-sm text-neutral-300 sm:basis-auto">
        {episodeTitle}
      </p>
      <PageFitControl />
      <ReadingDirectionControl />
      {canGoFullscreen ? (
        <button
          className={CONTROL_BUTTON_CLASS}
          onClick={onToggleFullscreen}
          type="button"
        >
          {isFullscreen ? "全画面を終了" : "全画面"}
        </button>
      ) : null}
    </div>
  );
};

const ViewerPageNavigation = () => {
  const { readingDirection } = useViewerContext();

  return (
    <PageNavigation aria-label="ページ送り">
      <PreviousPageButton aria-label="前のページ">
        {readingDirection === "rtl" ? (
          <ChevronRightIcon aria-hidden="true" />
        ) : (
          <ChevronLeftIcon aria-hidden="true" />
        )}
      </PreviousPageButton>
      <NextPageButton aria-label="次のページ">
        {readingDirection === "rtl" ? (
          <ChevronLeftIcon aria-hidden="true" />
        ) : (
          <ChevronRightIcon aria-hidden="true" />
        )}
      </NextPageButton>
    </PageNavigation>
  );
};

/**
 * The episode reader. Pages are fetched, decoded, and drawn by
 * `@publira/comic-viewer`, so the body images never become an `<img>` a reader
 * can drag out of the page, and a later encrypted delivery can be dropped in as
 * a plugin hook without changing this layout (#356 / #357).
 */
export const EpisodeComicViewer = ({
  episodeTitle,
  pages,
}: {
  episodeTitle: string;
  pages: ViewerPage[];
}) => {
  const shellRef = useRef<HTMLDivElement>(null);

  const toggleFullscreen = useCallback(async () => {
    const shell = shellRef.current;
    if (shell === null) {
      return;
    }

    try {
      if (document.fullscreenElement === null) {
        await shell.requestFullscreen();
        return;
      }
      await document.exitFullscreen();
    } catch {
      // ブラウザが全画面表示を断ったときは、いまの表示のまま読み続ける。
    }
  }, []);

  return (
    <div className="h-full w-full bg-neutral-950" ref={shellRef}>
      <ComicViewerRoot className="flex-col" pages={pages}>
        <ViewerControlBar
          episodeTitle={episodeTitle}
          onToggleFullscreen={toggleFullscreen}
        />
        <Viewport>
          <ViewerPageTemplate />
        </Viewport>
        <Toolbar>
          <PageProgress aria-label="読み進み">
            <PageProgressTrack />
            <PageStatus format={formatPageStatus} />
          </PageProgress>
        </Toolbar>
        <ViewerPageNavigation />
      </ComicViewerRoot>
    </div>
  );
};
