"use client";

import type { PageStatusValue, ViewerPage } from "@publira/comic-viewer";
import {
  describeVisiblePages,
  useBoxHeight,
  ViewerEmpty,
  ViewerNextPageButton,
  ViewerPage as ViewerPageTemplate,
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
} from "@publira/comic-viewer-shell";
import { useState } from "react";

import { ClientMessage, useClientMessages } from "#components/client-message";
import type { AdminClientMessageAccessor } from "#lib/messages";
import type { ReadingLayout } from "#lib/reading-layout";

/**
 * Names the visible pages for both the page status and the slider's
 * `aria-valuetext`, so the status the operator sees and the value a screen
 * reader announces are the same words. The preview has no end page, so a
 * screen showing no page of the episode has none to name.
 */
const buildPageStatusFormatter =
  (t: AdminClientMessageAccessor) =>
  (value: PageStatusValue): string => {
    const visible = describeVisiblePages(value);
    switch (visible.kind) {
      case "none":
      case "end-page": {
        return t("admin.series.episodes.preview.no_pages");
      }
      case "page": {
        return t("admin.series.episodes.preview.page_status", {
          first: visible.first,
          total: visible.total,
        });
      }
      case "spread": {
        return t("admin.series.episodes.preview.page_status_range", {
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

/**
 * The episode's pages in the reader the storefront uses, so a misordered or
 * mis-paired page shows before the episode goes live.
 *
 * `layout` is what the episode is read in once its own values and its
 * series' are resolved, and the viewer takes it only as it mounts: the section
 * keys this component by the pages and the layout, so a saved change remounts
 * it on the first page.
 *
 * The mat is the console's muted ground rather than the storefront's Sumi, so
 * the preview sits among the forms around it as one more surface of the
 * console; the controls are the same outline buttons.
 */
export const EpisodePreview = ({
  layout,
  pages,
}: {
  layout: ReadingLayout;
  pages: readonly ViewerPage[];
}) => {
  const t = useClientMessages();
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const boxHeight = useBoxHeight(box);
  const formatPageStatus = buildPageStatusFormatter(t);

  return (
    <div
      className="h-[min(70svh,40rem)] w-full overflow-hidden rounded-surface bg-muted [--viewer-ink:var(--color-foreground)] [--viewer-mat:var(--color-muted)] [--viewer-rule:var(--color-border)]"
      ref={setBox}
    >
      <ViewerRoot
        pages={pages}
        readingDirection={layout.readingDirection}
        spreadStartIndex={layout.spreadStartIndex}
      >
        <ViewerRail boxHeight={boxHeight}>
          <ViewerPageTemplate>
            <ViewerPageLoading>
              <ClientMessage message="admin.series.episodes.preview.loading" />
            </ViewerPageLoading>
            <ViewerPageError>
              <ViewerPageErrorMessage>
                <ClientMessage message="admin.series.episodes.preview.page_error" />
              </ViewerPageErrorMessage>
              <ViewerPageRetryButton>
                <ClientMessage message="admin.series.episodes.preview.reload" />
              </ViewerPageRetryButton>
            </ViewerPageError>
          </ViewerPageTemplate>
        </ViewerRail>
        <ViewerEmpty>
          <ClientMessage message="admin.series.episodes.preview.empty" />
        </ViewerEmpty>
        <ViewerToolbar>
          <ViewerProgress
            aria-label={t("admin.series.episodes.preview.progress")}
          >
            <ViewerProgressSlider format={formatPageStatus} />
            <ViewerPageStatus format={formatPageStatus} />
          </ViewerProgress>
        </ViewerToolbar>
        <ViewerPageNavigation
          aria-label={t("admin.series.episodes.preview.navigation")}
        >
          <ViewerPreviousPageButton
            aria-label={t("admin.series.episodes.preview.previous_page")}
          />
          <ViewerNextPageButton
            aria-label={t("admin.series.episodes.preview.next_page")}
          />
        </ViewerPageNavigation>
      </ViewerRoot>
    </div>
  );
};
