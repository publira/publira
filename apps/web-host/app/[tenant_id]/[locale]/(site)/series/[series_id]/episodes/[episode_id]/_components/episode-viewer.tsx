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
  SeriesCommentMode,
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
import { EpisodeComments, EpisodeCommentsSkeleton } from "./episode-comments";
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
 *
 * What a reader does once they have finished — react to the episode, read what
 * others said about it, say something themselves — is the page after the last
 * one. None of it is offered before the pages have been turned, because none of
 * it is a reader's to give or to read until then.
 */
export const EpisodeViewer = async ({
  commentMode,
  commentToken,
  episode,
  images,
  nextEpisode,
  previousEpisode,
  series,
}: {
  /** The series' resolved comment mode from GetSeriesDetail. */
  commentMode: SeriesCommentMode;
  /** Cursor of the comment page the URL asks for. Empty on the newest page. */
  commentToken: string;
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
          endPageStatus: t("host.episode.viewer.end_page"),
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
        endPage={
          <div className="grid justify-items-center gap-6">
            <SectionErrorBoundary
              title={
                <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                  <Message message="host.episode.reaction.control_error" />
                </Suspense>
              }
            >
              <Suspense fallback={<EpisodeReactionSkeleton />}>
                <EpisodeReactionControl
                  episodePublicId={episode.publicId}
                  ratingCount={episode.ratingCount}
                  returnTo={episodePath(series.publicId, episode.publicId)}
                  seriesPublicId={series.publicId}
                  tenantId={tenantId}
                />
              </Suspense>
            </SectionErrorBoundary>
            {commentMode === "disabled" ? null : (
              <SectionErrorBoundary
                title={
                  <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                    <Message message="host.episode.comments.list_error" />
                  </Suspense>
                }
              >
                <Suspense fallback={<EpisodeCommentsSkeleton />}>
                  <EpisodeComments
                    commentMode={commentMode}
                    episodePublicId={episode.publicId}
                    seriesPublicId={series.publicId}
                    tenantId={tenantId}
                    token={commentToken}
                  />
                </Suspense>
              </SectionErrorBoundary>
            )}
          </div>
        }
        initialPageIndex={
          // A URL naming a page of comments was followed from the comment page,
          // so that is where it opens rather than where the reader left off.
          commentToken
            ? images.length
            : resumePageIndex(savedPageIndex, images.length)
        }
        pages={toViewerPages(episode.title, images, (values) =>
          t("host.episode.viewer.page_title", values)
        )}
        readingDirection={episode.readingDirection}
        spreadStartIndex={episode.spreadStartIndex}
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
