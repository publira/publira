import {
  EmptyState,
  EmptyStateDescription,
} from "@publira/ui-components/empty-state";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { cn } from "@publira/utils";
import { Suspense } from "react";

import { EpisodeReactionSkeleton } from "#components/episode-reaction";
import { EpisodeReactionControl } from "#components/episode-reaction-control";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { resolveAccessToken } from "#lib/api-client";
import type {
  EpisodeDetail,
  EpisodeImageItem,
  EpisodeNeighborItem,
  EpisodeSeriesSummary,
} from "#lib/catalog";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getMyReadingPosition } from "#lib/reading-position";
import { getTenantId } from "#lib/tenant-id";

import { episodePath } from "../_lib/episode-path";
import { resumePageIndex } from "../_lib/reading-position";
import { VIEWER_HEIGHT_CLASS } from "../_lib/viewer-layout";
import { toViewerPages } from "../_lib/viewer-pages";
import { EpisodeBodyNotice } from "./episode-body-notice";
import { EpisodeComicViewer } from "./episode-comic-viewer";
import { EpisodeNeighborKeyNavigation } from "./episode-neighbor-key-navigation";
import { EpisodeNeighborLinks } from "./episode-neighbor-links";
import { EpisodeReadRecorder } from "./episode-read-recorder";
import { EpisodeReadingPositionRecorder } from "./episode-reading-position-recorder";

/**
 * The reader itself, with the page it opens at and the recorders that keep
 * that page up to date.
 *
 * The reading position is read here rather than alongside the episode body,
 * because a free episode reaches this component without a session ever being
 * resolved. It is read uncached and awaited before the viewer mounts: the page
 * the reader resumes on is the page the viewer draws first, not one it jumps
 * to once the reader is already looking at the first page.
 */
export const EpisodeViewer = async ({
  episode,
  images,
  nextEpisode,
  previousEpisode,
  series,
}: {
  episode: EpisodeDetail;
  images: EpisodeImageItem[];
  /** Absent on the last published episode of the series. */
  nextEpisode?: EpisodeNeighborItem;
  /** Absent on the first one. */
  previousEpisode?: EpisodeNeighborItem;
  series: EpisodeSeriesSummary;
}) => {
  // An episode whose pages are not published yet says so and nothing else,
  // so the catalog the reader's own chrome needs is read past the guard.
  if (images.length === 0) {
    return (
      <EpisodeBodyNotice>
        <EmptyState>
          <EmptyStateDescription>
            <Suspense fallback={<SkeletonLine className="mx-auto h-4 w-72" />}>
              <Message message="host.episode.images_empty" />
            </Suspense>
          </EmptyStateDescription>
        </EmptyState>
      </EpisodeBodyNotice>
    );
  }

  const locale = await getLocale();
  const [t, tenantId, accessToken] = await Promise.all([
    getMessagesFor(locale),
    getTenantId(),
    resolveAccessToken(),
  ]);
  const savedPageIndex = await getMyReadingPosition({
    accessToken,
    episodePublicId: episode.publicId,
    tenantId,
  });
  const nextHref = nextEpisode
    ? episodePath(series.publicId, nextEpisode.publicId)
    : undefined;
  const previousHref = previousEpisode
    ? episodePath(series.publicId, previousEpisode.publicId)
    : undefined;

  return (
    <div className={cn(VIEWER_HEIGHT_CLASS, "w-full")}>
      <EpisodeComicViewer
        copy={{
          enterFullscreen: t("host.episode.viewer.enter_fullscreen"),
          exitFullscreen: t("host.episode.viewer.exit_fullscreen"),
          loading: t("host.episode.viewer.loading"),
          navigation: t("host.episode.viewer.navigation"),
          nextPage: t("host.common.next_page"),
          noPages: t("host.episode.viewer.no_pages"),
          pageError: t("host.episode.viewer.page_error"),
          pageStatus: t("host.episode.viewer.page_status"),
          pageStatusRange: t("host.episode.viewer.page_status_range"),
          previousPage: t("host.common.previous_page"),
          progress: t("host.episode.viewer.progress"),
          reload: t("host.episode.viewer.reload"),
        }}
        initialPageIndex={resumePageIndex(savedPageIndex, images.length)}
        pages={toViewerPages(episode.title, images, (values) =>
          t("host.episode.viewer.page_title", values)
        )}
      >
        <EpisodeReadRecorder episode={episode} series={series} />
        {accessToken ? (
          <EpisodeReadingPositionRecorder episode={episode} series={series} />
        ) : null}
        <EpisodeNeighborLinks
          copy={{
            label: t("host.episode.navigation.label"),
            next: t("host.episode.navigation.next"),
            previous: t("host.episode.navigation.previous"),
          }}
          nextHref={nextHref}
          previousHref={previousHref}
        />
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex h-16 justify-center">
          <div className="pointer-events-auto mt-3">
            <SectionErrorBoundary
              title={
                <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                  <Message message="host.episode.reaction.control_error" />
                </Suspense>
              }
            >
              <Suspense fallback={<EpisodeReactionSkeleton size="sm" />}>
                <EpisodeReactionControl
                  episodePublicId={episode.publicId}
                  ratingCount={episode.ratingCount}
                  returnTo={episodePath(series.publicId, episode.publicId)}
                  seriesPublicId={series.publicId}
                  size="sm"
                  tenantId={tenantId}
                />
              </Suspense>
            </SectionErrorBoundary>
          </div>
        </div>
        <EpisodeNeighborKeyNavigation
          copy={{
            nextHint: t("host.episode.navigation.next_hint"),
            previousHint: t("host.episode.navigation.previous_hint"),
          }}
          nextHref={nextHref}
          previousHref={previousHref}
        />
      </EpisodeComicViewer>
    </div>
  );
};
