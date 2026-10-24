"use client";

import type { PageStatusValue, ViewerPage } from "@publira/comic-viewer";
import {
  describeVisiblePages,
  renewFromPageUrls,
  useBoxHeight,
} from "@publira/comic-viewer-shell";
import * as Viewer from "@publira/comic-viewer-shell/viewer";
import { useMemo, useState } from "react";

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
 * `renewPageUrls` reads the pages' URLs again, for a page the viewer reaches
 * after the admin media token in its URL has expired.
 *
 * The mat is the console's muted ground rather than the storefront's Sumi, so
 * the preview sits among the forms around it as one more surface of the
 * console; the controls are the same outline buttons.
 */
export const EpisodePreview = ({
  layout,
  pages,
  renewPageUrls,
}: {
  layout: ReadingLayout;
  pages: readonly ViewerPage[];
  /** Fresh URLs by image id; empty when there are none to give. */
  renewPageUrls: () => Promise<Record<string, string>>;
}) => {
  const t = useClientMessages();
  const renewPageUrl = useMemo(
    () => renewFromPageUrls(renewPageUrls),
    [renewPageUrls]
  );
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const boxHeight = useBoxHeight(box);
  const formatPageStatus = buildPageStatusFormatter(t);

  return (
    <div
      className="h-[min(70svh,40rem)] w-full overflow-hidden rounded-surface bg-muted [--viewer-ink:var(--color-foreground)] [--viewer-mat:var(--color-muted)] [--viewer-rule:var(--color-border)]"
      ref={setBox}
    >
      <Viewer.Root
        pages={pages}
        readingDirection={layout.readingDirection}
        renewPageUrl={renewPageUrl}
        spreadStartIndex={layout.spreadStartIndex}
      >
        <Viewer.Rail
          aria-label={t("admin.series.episodes.preview.pages")}
          boxHeight={boxHeight}
        >
          <Viewer.Page>
            <Viewer.PageLoading>
              <ClientMessage message="admin.series.episodes.preview.loading" />
            </Viewer.PageLoading>
            <Viewer.PageError>
              <Viewer.PageErrorMessage>
                <ClientMessage message="admin.series.episodes.preview.page_error" />
              </Viewer.PageErrorMessage>
              <Viewer.PageRetryButton>
                <ClientMessage message="admin.series.episodes.preview.reload" />
              </Viewer.PageRetryButton>
            </Viewer.PageError>
          </Viewer.Page>
        </Viewer.Rail>
        <Viewer.Empty>
          <ClientMessage message="admin.series.episodes.preview.empty" />
        </Viewer.Empty>
        <Viewer.Toolbar>
          <Viewer.Progress
            aria-label={t("admin.series.episodes.preview.progress")}
          >
            <Viewer.ProgressSlider format={formatPageStatus} />
            <Viewer.PageStatus format={formatPageStatus} />
          </Viewer.Progress>
        </Viewer.Toolbar>
        <Viewer.PageNavigation
          aria-label={t("admin.series.episodes.preview.navigation")}
        >
          <Viewer.PreviousPageButton
            aria-label={t("admin.series.episodes.preview.previous_page")}
          />
          <Viewer.NextPageButton
            aria-label={t("admin.series.episodes.preview.next_page")}
          />
        </Viewer.PageNavigation>
      </Viewer.Root>
    </div>
  );
};
