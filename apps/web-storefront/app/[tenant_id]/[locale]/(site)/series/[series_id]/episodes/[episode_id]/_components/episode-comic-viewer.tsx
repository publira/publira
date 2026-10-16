"use client";

import { EndPage, useViewerContext } from "@publira/comic-viewer";
import type {
  PageStatusValue,
  ReadingDirection,
  ViewerPage as ViewerPageItem,
} from "@publira/comic-viewer";
import {
  describeVisiblePages,
  useBoxHeight,
  ViewerBackwardIcon,
  ViewerForwardIcon,
  ViewerNextPageButton,
  ViewerPage,
  ViewerPageError,
  ViewerPageErrorMessage,
  ViewerPageLoading,
  ViewerPageNavigation,
  ViewerPageRetryButton,
  ViewerPageStatus,
  ViewerPreviousPageButton,
  ViewerProgress,
  ViewerProgressSlider,
  ViewerRail,
  ViewerRoot,
  ViewerToolbar,
  ViewerToolbarActions,
} from "@publira/comic-viewer-shell";
import {
  FoldHorizontalIcon,
  MaximizeIcon,
  MinimizeIcon,
  UnfoldHorizontalIcon,
} from "@publira/icons";
import { Button, buttonVariants } from "@publira/ui-components/button";
import { cn } from "@publira/utils";
import { useCallback, useState, useSyncExternalStore } from "react";
import type { CSSProperties, MouseEvent, ReactNode } from "react";

import { ClientMessage, useClientMessages } from "#components/client-message";
import { LocaleLink } from "#components/locale-link";
import type { StorefrontClientMessageAccessor } from "#lib/messages";
import { useWebStorage, writeWebStorage } from "#lib/web-storage";

const stopClick = (event: MouseEvent) => {
  event.stopPropagation();
};

/**
 * Names the visible pages for both `PageStatus` and the slider's
 * `aria-valuetext`, so the status a reader sees and the value a screen reader
 * announces are the same words. It returns a string because the attribute
 * cannot hold anything else.
 */
const buildPageStatusFormatter =
  (t: StorefrontClientMessageAccessor) =>
  (value: PageStatusValue): string => {
    const visible = describeVisiblePages(value);
    switch (visible.kind) {
      case "none": {
        return t("storefront.episode.viewer.no_pages");
      }
      case "end-page": {
        return t("storefront.episode.viewer.end_page");
      }
      case "page": {
        return t("storefront.episode.viewer.page_status", {
          first: visible.first,
          total: visible.total,
        });
      }
      case "spread": {
        return t("storefront.episode.viewer.page_status_range", {
          first: visible.first,
          last: visible.last,
          total: visible.total,
        });
      }
      default: {
        return visible satisfies never;
      }
    }
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
 * The shape of the end page's sheet when the last page carries no stored
 * dimensions: the B-series proportion print comics are made in.
 */
const FALLBACK_PAGE_ASPECT = 1 / Math.SQRT2;

/** Width over height of the last page, which the end page's sheet takes. */
const endPageAspect = (pages: readonly ViewerPageItem[]): number => {
  const lastPage = pages.at(-1);

  return lastPage?.width && lastPage.height
    ? lastPage.width / lastPage.height
    : FALLBACK_PAGE_ASPECT;
};

/** The wide viewer choice this tab has made, which wins over the stored one. */
const WIDE_VIEWER_STORAGE_KEY = "publira.wide-viewer";

const FullscreenButton = ({ onToggle }: { onToggle: () => void }) => {
  const t = useClientMessages();
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
      aria-label={
        isFullscreen
          ? t("storefront.episode.viewer.exit_fullscreen")
          : t("storefront.episode.viewer.enter_fullscreen")
      }
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
  const t = useClientMessages();

  return (
    <Button
      aria-label={
        isWide
          ? t("storefront.episode.viewer.collapse_viewer")
          : t("storefront.episode.viewer.expand_viewer")
      }
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

/** The shell's toolbar, with the wide viewer and full screen controls. */
const EpisodeViewerToolbar = ({
  isWide,
  onToggleFullscreen,
  onToggleWide,
}: {
  isWide: boolean;
  onToggleFullscreen: () => void;
  onToggleWide: () => void;
}) => {
  const t = useClientMessages();
  const formatPageStatus = buildPageStatusFormatter(t);

  return (
    <ViewerToolbar>
      <ViewerProgress aria-label={t("storefront.episode.viewer.progress")}>
        <ViewerProgressSlider format={formatPageStatus} />
        <ViewerPageStatus format={formatPageStatus} />
      </ViewerProgress>
      <ViewerToolbarActions>
        <WideViewerButton isWide={isWide} onToggle={onToggleWide} />
        <FullscreenButton onToggle={onToggleFullscreen} />
      </ViewerToolbarActions>
    </ViewerToolbar>
  );
};

/**
 * The page-turn pair, as the outline buttons the rest of the site uses.
 *
 * At either end of the episode the control that has run out of pages hands
 * over to the neighbouring episode, where there is one: it is what a reader
 * holding a tablet has in place of the arrow key that does the same past the
 * last page, and it is drawn and hidden with the controls a tap reveals. It
 * says in words where it goes, because the chevron alone would promise another
 * page.
 */
const EpisodeViewerPageNavigation = ({
  nextEpisodeHref,
  previousEpisodeHref,
}: {
  nextEpisodeHref?: string;
  previousEpisodeHref?: string;
}) => {
  const t = useClientMessages();
  const { currentIndex, maxIndex, minIndex } = useViewerContext();
  const episodeLinkClassName = cn(
    buttonVariants({ variant: "outline" }),
    "pointer-events-auto absolute top-1/2"
  );

  return (
    <ViewerPageNavigation
      aria-label={t("storefront.episode.viewer.navigation")}
    >
      {previousEpisodeHref !== undefined && currentIndex <= minIndex ? (
        <LocaleLink
          className={cn(episodeLinkClassName, "start-3")}
          href={previousEpisodeHref}
        >
          <ViewerBackwardIcon />
          <ClientMessage message="storefront.episode.navigation.previous" />
        </LocaleLink>
      ) : (
        <ViewerPreviousPageButton
          aria-label={t("storefront.common.previous_page")}
        />
      )}
      {nextEpisodeHref !== undefined && currentIndex >= maxIndex ? (
        <LocaleLink
          className={cn(episodeLinkClassName, "end-3")}
          href={nextEpisodeHref}
        >
          <ClientMessage message="storefront.episode.navigation.next" />
          <ViewerForwardIcon />
        </LocaleLink>
      ) : (
        <ViewerNextPageButton aria-label={t("storefront.common.next_page")} />
      )}
    </ViewerPageNavigation>
  );
};

/**
 * The episode reader, on the shell `@publira/comic-viewer-shell` shares with
 * the admin console's preview. Pages are fetched, decoded, and drawn by
 * `@publira/comic-viewer`, so the body images never become an `<img>` a reader
 * can drag out of the page.
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
 * lives. It is a page of the reader, so it is drawn as a paper sheet the shape
 * of the last page, on the mat and against the gutter as the pages are, with
 * its content centred on the sheet.
 *
 * `wideViewerEnabled` is the choice the server read; one made in this tab since
 * wins over it, so the reader never waits on `saveWideViewer`.
 *
 * `nextEpisodeHref` and `previousEpisodeHref` are the neighbouring episodes'
 * bare paths, offered by the page-turn control at the end that has run out.
 */
export const EpisodeComicViewer = ({
  children,
  endPage,
  initialPageIndex = 0,
  nextEpisodeHref,
  pages,
  previousEpisodeHref,
  readingDirection,
  saveWideViewer,
  spreadStartIndex,
  wideViewerEnabled,
}: {
  children?: ReactNode;
  /** Absent where the episode ends on its last page. */
  endPage?: ReactNode;
  /** Zero-based page the reader opens at. */
  initialPageIndex?: number;
  /** Absent on the last published episode of the series. */
  nextEpisodeHref?: string;
  pages: ViewerPageItem[];
  /** Absent on the first one. */
  previousEpisodeHref?: string;
  readingDirection: ReadingDirection;
  /** Absent for a reader with no session. */
  saveWideViewer?: (enabled: boolean) => Promise<void>;
  spreadStartIndex: number;
  wideViewerEnabled: boolean;
}) => {
  const t = useClientMessages();
  const [shell, setShell] = useState<HTMLDivElement | null>(null);
  const boxHeight = useBoxHeight(shell);
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
  }, [shell]);

  return (
    <div
      className="size-full bg-foreground [--viewer-ink:var(--color-background)] [--viewer-mat:var(--color-foreground)] [--viewer-rule:var(--color-muted-foreground)]"
      ref={setShell}
    >
      <ViewerRoot
        initialPageIndex={initialPageIndex}
        pages={pages}
        readingDirection={readingDirection}
        spreadStartIndex={spreadStartIndex}
      >
        <ViewerRail boxHeight={boxHeight}>
          <ViewerPage>
            <ViewerPageLoading>
              <ClientMessage message="storefront.episode.viewer.loading" />
            </ViewerPageLoading>
            <ViewerPageError>
              <ViewerPageErrorMessage>
                <ClientMessage message="storefront.episode.viewer.page_error" />
              </ViewerPageErrorMessage>
              <ViewerPageRetryButton>
                <ClientMessage message="storefront.episode.viewer.reload" />
              </ViewerPageRetryButton>
            </ViewerPageError>
          </ViewerPage>
        </ViewerRail>
        {endPage === undefined ? null : (
          /* A click here reads and scrolls rather than turns: the reader
               leaves this page with the page-turn controls, not by tapping its
               edge, and the same exception the viewport makes for a control
               applies to the text between them. */
          <EndPage
            className="[container-type:size] flex size-full min-w-0 items-center justify-center data-[page-side=left]:justify-end data-[page-side=right]:justify-start"
            onClick={stopClick}
          >
            {/* Sized in container units, so the sheet fits the slot the way a
                page canvas does: as large as the slot allows at the page's
                own proportion. */}
            <section
              aria-label={t("storefront.episode.viewer.end_page")}
              className="flex h-[min(100cqh,calc(100cqw/var(--end-page-aspect)))] w-[min(100cqw,calc(100cqh*var(--end-page-aspect)))] flex-col overflow-y-auto overscroll-contain bg-background text-foreground"
              style={
                { "--end-page-aspect": endPageAspect(pages) } as CSSProperties
              }
            >
              <div className="m-auto w-full max-w-measure-prose px-6 py-8">
                {endPage}
              </div>
            </section>
          </EndPage>
        )}
        <EpisodeViewerToolbar
          isWide={isWide}
          onToggleFullscreen={toggleFullscreen}
          onToggleWide={toggleWide}
        />
        <EpisodeViewerPageNavigation
          nextEpisodeHref={nextEpisodeHref}
          previousEpisodeHref={previousEpisodeHref}
        />
        {isWide ? <WideViewerMarker /> : null}
        {children}
      </ViewerRoot>
    </div>
  );
};
