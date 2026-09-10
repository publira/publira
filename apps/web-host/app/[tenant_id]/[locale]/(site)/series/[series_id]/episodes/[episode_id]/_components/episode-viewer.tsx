import { getMessage } from "@publira/i18n";
import {
  EmptyState,
  EmptyStateDescription,
} from "@publira/ui-components/empty-state";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { cn } from "@publira/utils";
import { Suspense } from "react";

import { Message } from "#components/message";
import { resolveAccessToken } from "#lib/api-client";
import type {
  EpisodeDetail,
  EpisodeImageItem,
  EpisodeNeighborItem,
  EpisodeSeriesSummary,
} from "#lib/catalog";
import { getLocale, loadHostMessages } from "#lib/locale";
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
  const [messages, tenantId, accessToken] = await Promise.all([
    loadHostMessages(locale),
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
          enterFullscreen: getMessage(
            messages,
            "host.episode.viewer.enter_fullscreen"
          ),
          exitFullscreen: getMessage(
            messages,
            "host.episode.viewer.exit_fullscreen"
          ),
          loading: getMessage(messages, "host.episode.viewer.loading"),
          navigation: getMessage(messages, "host.episode.viewer.navigation"),
          nextPage: getMessage(messages, "host.common.next_page"),
          noPages: getMessage(messages, "host.episode.viewer.no_pages"),
          pageError: getMessage(messages, "host.episode.viewer.page_error"),
          pageStatus: getMessage(messages, "host.episode.viewer.page_status"),
          pageStatusRange: getMessage(
            messages,
            "host.episode.viewer.page_status_range"
          ),
          previousPage: getMessage(messages, "host.common.previous_page"),
          progress: getMessage(messages, "host.episode.viewer.progress"),
          reload: getMessage(messages, "host.episode.viewer.reload"),
        }}
        initialPageIndex={resumePageIndex(savedPageIndex, images.length)}
        pages={toViewerPages(episode.title, images, (values) =>
          getMessage(messages, "host.episode.viewer.page_title", values)
        )}
      >
        <EpisodeReadRecorder episode={episode} series={series} />
        {accessToken ? (
          <EpisodeReadingPositionRecorder episode={episode} series={series} />
        ) : null}
        <EpisodeNeighborLinks
          copy={{
            label: getMessage(messages, "host.episode.navigation.label"),
            next: getMessage(messages, "host.episode.navigation.next"),
            previous: getMessage(messages, "host.episode.navigation.previous"),
          }}
          nextHref={nextHref}
          previousHref={previousHref}
        />
        <EpisodeNeighborKeyNavigation
          copy={{
            nextHint: getMessage(messages, "host.episode.navigation.next_hint"),
            previousHint: getMessage(
              messages,
              "host.episode.navigation.previous_hint"
            ),
          }}
          nextHref={nextHref}
          previousHref={previousHref}
        />
      </EpisodeComicViewer>
    </div>
  );
};
