"use client";

import {
  EndPage,
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
  ViewportPageSet,
  ViewportPageSlot,
  ViewportTrack,
} from "@publira/comic-viewer";
import type {
  PageStatusProps,
  ReadingDirection,
  ViewerPage,
} from "@publira/comic-viewer";
import { formatMessage } from "@publira/i18n";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  FoldHorizontalIcon,
  MaximizeIcon,
  MinimizeIcon,
  UnfoldHorizontalIcon,
} from "@publira/icons";
import { Button, buttonVariants } from "@publira/ui-components/button";
import { cn } from "@publira/utils";
import {
  createContext,
  use,
  useCallback,
  useRef,
  useSyncExternalStore,
} from "react";
import type { MouseEvent, ReactNode } from "react";

import { useWebStorage, writeWebStorage } from "#lib/web-storage";

import { acceptNegotiatedImages } from "../_lib/viewer-fetch";

/**
 * Every string this reader shows, resolved on the server and handed down as
 * one object. The viewer's own hooks decide where each one appears, so the
 * copy cannot travel as `ReactNode` children — `aria-label` and the page
 * status format both need plain strings.
 */
export interface EpisodeComicViewerCopy {
  collapseViewer: string;
  /** Where the reader is while the page after the last one is on screen. */
  endPageStatus: string;
  enterFullscreen: string;
  exitFullscreen: string;
  expandViewer: string;
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

const VIEWER_PLUGINS = [acceptNegotiatedImages];

const stopClick = (event: MouseEvent) => {
  event.stopPropagation();
};

const buildPageStatusFormatter =
  (copy: EpisodeComicViewerCopy): NonNullable<PageStatusProps["format"]> =>
  ({ firstPage, lastPage, pageCount, slot }) => {
    if (pageCount === 0) {
      return copy.noPages;
    }

    // An extra page is counted in neither the numbers nor the total, so a
    // screen holding nothing else has no page number to report.
    if (firstPage === 0) {
      return slot === "end" ? copy.endPageStatus : copy.noPages;
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

/** The wide viewer choice this tab has made, which wins over the stored one. */
const WIDE_VIEWER_STORAGE_KEY = "publira.wide-viewer";

/**
 * The rail the reader turns pages on: three viewports wide, holding the
 * spread before this one, the one on screen, and the one after it.
 *
 * `children` is the template every visible page is drawn from.
 */
const ViewerRail = ({ children }: { children: ReactNode }) => (
  <Viewport className="group relative flex size-full min-h-0 min-w-0 flex-1 touch-pan-y items-stretch overflow-hidden data-[pannable]:cursor-grab data-[pannable]:touch-none data-[panning]:cursor-grabbing">
    <ViewportTrack className="flex h-full w-[300%] shrink-0 basis-[300%] [transform:translateX(calc(-33.3333%_+_var(--pcv-drag-offset,0px)))] items-stretch transition-transform duration-[260ms] ease-out data-[dragging]:transition-none data-[transition-state=active]:data-[slide-direction=left]:[transform:translateX(calc(-66.6667%_+_var(--pcv-drag-offset,0px)))] data-[transition-state=active]:data-[slide-direction=right]:[transform:translateX(var(--pcv-drag-offset,0px))]">
      <ViewportPageSet className="flex h-full min-w-0 shrink-0 basis-1/3 [transform:translate(var(--pcv-pan-x,0),var(--pcv-pan-y,0))_scale(var(--pcv-zoom-scale,1))] items-stretch data-[page-side=left]:justify-start data-[page-side=right]:justify-end">
        {/* The two pages of a spread meet at the centre line as they do on a
            printed sheet, so each hugs the edge of its half that faces the
            gutter. */}
        <ViewportPageSlot className="flex min-w-0 flex-1 items-center justify-center data-[page-side=left]:justify-end data-[page-side=right]:justify-start data-[view-mode=double]:max-w-1/2 data-[view-mode=double]:basis-1/2">
          {children}
        </ViewportPageSlot>
      </ViewportPageSet>
    </ViewportTrack>
  </Viewport>
);

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
    <ViewportPage className="relative flex size-full min-w-0 items-center justify-center data-[page-side=left]:justify-end data-[page-side=right]:justify-start">
      {/* A preview standing in for the full page is faded back toward the mat. */}
      <PageCanvas className="block h-full max-h-full w-auto max-w-full bg-foreground object-contain group-data-[page-fit-mode=actual]:size-auto group-data-[page-fit-mode=actual]:max-h-none group-data-[page-fit-mode=actual]:max-w-none group-data-[page-fit-mode=width]:h-auto group-data-[page-fit-mode=width]:max-h-none group-data-[page-fit-mode=width]:w-full group-data-[page-fit-mode=width]:max-w-none data-[placeholder]:opacity-70" />
      {status === "loading" ? (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-background">
          {copy.loading}
        </p>
      ) : null}
      {status === "error" ? (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-foreground/90 px-6 text-center"
          role="alert"
        >
          <p className="text-sm text-background">{copy.pageError}</p>
          {/* The click stops here. A click near the edge of the viewport turns
              the page, and an unpaired page keeps the half of the spread its
              own parity gives it — so this control is drawn inside that zone
              whenever the page it covers stands alone. Without this the reader
              would be carried to the next spread by the button they pressed to
              stay put. The viewport already makes the same exception for
              keyboard input. */}
          <Button
            onClick={(event) => {
              event.stopPropagation();
              retry();
            }}
            size="sm"
            variant="outline"
          >
            {copy.reload}
          </Button>
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
    <Button
      aria-label={isFullscreen ? copy.exitFullscreen : copy.enterFullscreen}
      onClick={onToggle}
      size="icon"
      variant="outline"
    >
      {isFullscreen ? (
        <MinimizeIcon aria-hidden="true" className="size-5" />
      ) : (
        <MaximizeIcon aria-hidden="true" className="size-5" />
      )}
    </Button>
  );
};

const WideViewerButton = ({
  isWide,
  onToggle,
}: {
  isWide: boolean;
  onToggle: () => void;
}) => {
  const copy = useCopy();

  return (
    <Button
      aria-label={isWide ? copy.collapseViewer : copy.expandViewer}
      aria-pressed={isWide}
      onClick={onToggle}
      size="icon"
      variant="outline"
    >
      {isWide ? (
        <FoldHorizontalIcon aria-hidden="true" className="size-5" />
      ) : (
        <UnfoldHorizontalIcon aria-hidden="true" className="size-5" />
      )}
    </Button>
  );
};

/**
 * The element the site header matches with `group-has-*` to give way to a wide
 * viewer, retracting whenever the viewer's own controls hide.
 */
const WideViewerMarker = () => {
  const { areControlsVisible } = useViewerContext();

  return (
    <div
      data-wide-viewer={areControlsVisible ? "revealed" : "retracted"}
      hidden
    />
  );
};

/** A band of the same ink as the mat, told apart from it by a hairline. */
const ViewerToolbar = ({
  isWide,
  onToggleFullscreen,
  onToggleWide,
}: {
  isWide: boolean;
  onToggleFullscreen: () => void;
  onToggleWide: () => void;
}) => {
  const copy = useCopy();

  return (
    <Toolbar className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-2 border-t border-muted-foreground bg-foreground p-3 transition duration-state ease-state aria-hidden:translate-y-2 aria-hidden:opacity-0">
      <PageProgress
        aria-label={copy.progress}
        className="mx-auto min-w-0 shrink basis-3/5"
      >
        <PageProgressTrack className="block h-1 w-full appearance-none overflow-hidden rounded-control border-0 bg-muted-foreground [&::-moz-progress-bar]:bg-background [&::-webkit-progress-bar]:bg-transparent [&::-webkit-progress-value]:bg-background" />
        {/* The toolbar runs rtl so the progress fills the way pages turn; the
            status text still reads left to right. */}
        <PageStatus
          className="mt-1.5 block text-center text-sm text-background tabular-nums [direction:ltr]"
          format={buildPageStatusFormatter(copy)}
        />
      </PageProgress>
      {/* Placed against the physical right edge rather than laid out in the
          toolbar's flow, which runs right to left with the reading direction. */}
      <div className="absolute right-3 bottom-3 flex gap-2">
        <WideViewerButton isWide={isWide} onToggle={onToggleWide} />
        <FullscreenButton onToggle={onToggleFullscreen} />
      </div>
    </Toolbar>
  );
};

/** The page-turn pair, as the outline buttons the rest of the site uses. */
const ViewerPageNavigation = () => {
  const copy = useCopy();
  const { readingDirection } = useViewerContext();
  const buttonClassName = cn(
    buttonVariants({ size: "icon", variant: "outline" }),
    "pointer-events-auto absolute top-1/2"
  );

  return (
    <PageNavigation
      aria-label={copy.navigation}
      className="pointer-events-none absolute inset-0 z-10 transition duration-state ease-state aria-hidden:translate-y-2 aria-hidden:opacity-0"
    >
      <PreviousPageButton
        aria-label={copy.previousPage}
        className={cn(buttonClassName, "start-3")}
      >
        {readingDirection === "rtl" ? (
          <ChevronRightIcon aria-hidden="true" className="size-5" />
        ) : (
          <ChevronLeftIcon aria-hidden="true" className="size-5" />
        )}
      </PreviousPageButton>
      <NextPageButton
        aria-label={copy.nextPage}
        className={cn(buttonClassName, "end-3")}
      >
        {readingDirection === "rtl" ? (
          <ChevronLeftIcon aria-hidden="true" className="size-5" />
        ) : (
          <ChevronRightIcon aria-hidden="true" className="size-5" />
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
 * The mat is Sumi rather than paper, which is the one place this design's
 * light scheme does not reach: comics are drawn in black and white, and a page
 * on a near-white ground has its own white dissolve into the screen. Text over
 * the mat is inverted to match; the controls stay the site's paper buttons.
 *
 * `children` are mounted inside the viewer root, for the components that read
 * the reader's progress but draw nothing — the read recorder and the reading
 * position recorder today. They sit here rather than arriving as ids on this
 * component so the reader itself stays about reading.
 *
 * `initialPageIndex` is where the reader left the episode, resolved on the
 * server. It is the page the viewer mounts on rather than a page it moves to
 * afterwards, so the reader never sees the first page of an episode they are
 * in the middle of.
 *
 * `readingDirection` and `spreadStartIndex` are the episode's own layout,
 * already resolved by the public read, so this viewer does not pick a default.
 *
 * `endPage` is turned to after the last page, which is where the comment form
 * lives. It is drawn on paper rather than on the mat, so the site's own
 * controls read there exactly as they do under the reader.
 *
 * `wideViewerEnabled` is the choice the server read; one made in this tab since
 * wins over it, so the reader never waits on `saveWideViewer`.
 */
export const EpisodeComicViewer = ({
  children,
  copy,
  endPage,
  initialPageIndex = 0,
  pages,
  readingDirection,
  saveWideViewer,
  spreadStartIndex,
  wideViewerEnabled,
}: {
  children?: ReactNode;
  copy: EpisodeComicViewerCopy;
  /** Absent where the episode ends on its last page. */
  endPage?: ReactNode;
  /** Zero-based page the reader opens at. */
  initialPageIndex?: number;
  pages: ViewerPage[];
  readingDirection: ReadingDirection;
  /** Absent for a reader with no session. */
  saveWideViewer?: (enabled: boolean) => Promise<void>;
  spreadStartIndex: number;
  wideViewerEnabled: boolean;
}) => {
  const shellRef = useRef<HTMLDivElement>(null);
  const wideViewerChoice = useWebStorage("session", WIDE_VIEWER_STORAGE_KEY);
  const isWide =
    wideViewerChoice === null ? wideViewerEnabled : wideViewerChoice === "true";

  const toggleWide = async () => {
    const next = !isWide;
    writeWebStorage("session", WIDE_VIEWER_STORAGE_KEY, String(next));
    try {
      await saveWideViewer?.(next);
    } catch {
      // The choice already holds in this tab, and the next press writes again.
    }
  };

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
      <div className="size-full bg-foreground" ref={shellRef}>
        <ComicViewerRoot
          className="relative flex size-full min-h-0 min-w-0 touch-pan-y overflow-hidden bg-foreground text-background"
          initialIndex={initialPageIndex}
          initialReadingDirection={readingDirection}
          pages={pages}
          plugins={VIEWER_PLUGINS}
          spreadStartIndex={spreadStartIndex}
        >
          <ViewerRail>
            <ViewerPageTemplate />
          </ViewerRail>
          {endPage === undefined ? null : (
            /* A click here reads and scrolls rather than turns: the reader
               leaves this page with the page-turn controls, not by tapping its
               edge, and the same exception the viewport makes for a control
               applies to the text between them. */
            <EndPage
              className="size-full min-w-0 overflow-y-auto overscroll-contain bg-background text-foreground"
              onClick={stopClick}
            >
              {/* The chrome the viewer draws over its top and bottom edges
                  reaches this page too, so the content clears both. */}
              <div className="mx-auto w-full max-w-(--measure-prose) px-6 pt-20 pb-24">
                {endPage}
              </div>
            </EndPage>
          )}
          <ViewerToolbar
            isWide={isWide}
            onToggleFullscreen={toggleFullscreen}
            onToggleWide={toggleWide}
          />
          <ViewerPageNavigation />
          {isWide ? <WideViewerMarker /> : null}
          {children}
        </ComicViewerRoot>
      </div>
    </CopyContext>
  );
};
