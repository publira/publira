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
import { formatMessage } from "@publira/i18n";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MaximizeIcon,
  MinimizeIcon,
} from "@publira/icons";
import {
  createContext,
  use,
  useCallback,
  useRef,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";

import { acceptNegotiatedImages } from "../_lib/viewer-fetch";

/**
 * Every string this reader shows, resolved on the server and handed down as
 * one object. The viewer's own hooks decide where each one appears, so the
 * copy cannot travel as `ReactNode` children — `aria-label` and the page
 * status format both need plain strings.
 */
export interface EpisodeComicViewerCopy {
  enterFullscreen: string;
  exitFullscreen: string;
  loading: string;
  navigation: string;
  nextPage: string;
  noPages: string;
  pageError: string;
  /** `{first}` / `{total}` — one page on screen. */
  pageStatus: string;
  /** `{first}` / `{last}` / `{total}` — a spread on screen. */
  pageStatusRange: string;
  previousPage: string;
  progress: string;
  reload: string;
}

const CopyContext = createContext<EpisodeComicViewerCopy | null>(null);

const useCopy = (): EpisodeComicViewerCopy => {
  const copy = use(CopyContext);
  if (!copy) {
    throw new Error("EpisodeComicViewer copy is missing");
  }
  return copy;
};

/**
 * The cover stands alone and pairing starts from the page after it, the way a
 * printed volume opens. Without this the cover would be paired with page 2 and
 * every spread after it would face the wrong way.
 *
 * Which way those spreads face is not set here at all: right to left is the
 * library's own default, and it is the binding this catalog is drawn for, so
 * `readingDirection` is left alone rather than restated as the value it
 * already has.
 */
const SPREAD_START_INDEX = 1;

const VIEWER_PLUGINS = [acceptNegotiatedImages];

const buildPageStatusFormatter =
  (copy: EpisodeComicViewerCopy): NonNullable<PageStatusProps["format"]> =>
  ({ firstPage, lastPage, pageCount }) => {
    if (pageCount === 0) {
      return copy.noPages;
    }

    return firstPage === lastPage
      ? formatMessage(copy.pageStatus, { first: firstPage, total: pageCount })
      : formatMessage(copy.pageStatusRange, {
          first: firstPage,
          last: lastPage,
          total: pageCount,
        });
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
  const copy = useCopy();
  const { retry, status } = usePageLoadState();

  return (
    <ViewportPage className="relative">
      <PageCanvas />
      {status === "loading" ? (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-neutral-400">
          {copy.loading}
        </p>
      ) : null}
      {status === "error" ? (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-950/85 px-6 text-center"
          role="alert"
        >
          <p className="text-sm text-neutral-200">{copy.pageError}</p>
          {/* The click stops here. A click near the edge of the viewport turns
              the page, and an unpaired page keeps the half of the spread its
              own parity gives it — so this control is drawn inside that zone
              whenever the page it covers stands alone. Without this the reader
              would be carried to the next spread by the button they pressed to
              stay put. The viewport already makes the same exception for
              keyboard input. */}
          <button
            className="rounded-full border border-neutral-500 px-4 py-1.5 text-sm font-medium text-neutral-100 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-100"
            onClick={(event) => {
              event.stopPropagation();
              retry();
            }}
            type="button"
          >
            {copy.reload}
          </button>
        </div>
      ) : null}
    </ViewportPage>
  );
};

const FullscreenButton = ({ onToggle }: { onToggle: () => void }) => {
  const copy = useCopy();
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

  if (!canGoFullscreen) {
    return null;
  }

  return (
    /* Placed against the physical right edge rather than laid out in the
       toolbar's flow, which runs right to left with the reading direction. */
    <button
      aria-label={isFullscreen ? copy.exitFullscreen : copy.enterFullscreen}
      className="absolute right-3 bottom-3 grid size-9 place-items-center rounded-full bg-black/60 text-neutral-100 transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-100"
      onClick={onToggle}
      type="button"
    >
      {isFullscreen ? (
        <MinimizeIcon aria-hidden="true" className="size-5" />
      ) : (
        <MaximizeIcon aria-hidden="true" className="size-5" />
      )}
    </button>
  );
};

const ViewerPageNavigation = () => {
  const copy = useCopy();
  const { readingDirection } = useViewerContext();

  return (
    <PageNavigation aria-label={copy.navigation}>
      <PreviousPageButton aria-label={copy.previousPage}>
        {readingDirection === "rtl" ? (
          <ChevronRightIcon aria-hidden="true" />
        ) : (
          <ChevronLeftIcon aria-hidden="true" />
        )}
      </PreviousPageButton>
      <NextPageButton aria-label={copy.nextPage}>
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
 * a plugin hook without changing this layout.
 *
 * `children` are mounted inside the viewer root, for the components that read
 * the reader's progress but draw nothing — the read recorder today. They sit
 * here rather than arriving as ids on this component so the reader itself
 * stays about reading.
 */
export const EpisodeComicViewer = ({
  children,
  copy,
  pages,
}: {
  children?: ReactNode;
  copy: EpisodeComicViewerCopy;
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
      // A browser that refuses full screen leaves the reader on the page as it
      // is, which is the useful outcome.
    }
  }, []);

  return (
    <CopyContext value={copy}>
      <div className="h-full w-full bg-neutral-950" ref={shellRef}>
        <ComicViewerRoot
          pages={pages}
          plugins={VIEWER_PLUGINS}
          spreadStartIndex={SPREAD_START_INDEX}
        >
          <Viewport>
            <ViewerPageTemplate />
          </Viewport>
          <Toolbar>
            <PageProgress aria-label={copy.progress}>
              <PageProgressTrack />
              {/* The toolbar runs rtl so the progress fills the way pages turn;
                  the status text still reads left to right. */}
              <PageStatus
                className="[direction:ltr]"
                format={buildPageStatusFormatter(copy)}
              />
            </PageProgress>
            <FullscreenButton onToggle={toggleFullscreen} />
          </Toolbar>
          <ViewerPageNavigation />
          {children}
        </ComicViewerRoot>
      </div>
    </CopyContext>
  );
};
