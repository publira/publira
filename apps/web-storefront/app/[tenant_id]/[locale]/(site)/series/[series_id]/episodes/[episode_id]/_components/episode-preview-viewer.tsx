import { toViewerPages } from "@publira/comic-viewer-shell";
import { cn } from "@publira/utils";
import type { ReactNode } from "react";

import { resolveAccessToken } from "#lib/api-client";
import type {
  EpisodeDetail,
  EpisodeImageItem,
  EpisodeNeighborItem,
  EpisodeSeriesSummary,
} from "#lib/catalog";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantId } from "#lib/tenant-id";
import { getMyViewerPreferences } from "#lib/viewer-preferences";

import { episodePath } from "../_lib/episode-path";
import { VIEWER_HEIGHT_CLASS } from "../_lib/viewer-layout";
import { saveWideViewerAction } from "../_lib/wide-viewer-action";
import { EpisodeComicViewer } from "./episode-comic-viewer";
import { EpisodeNeighborKeyNavigation } from "./episode-neighbor-key-navigation";

/**
 * The reader over a paid episode's preview pages, with the gate as the page
 * after the last of them: a reader meets the purchase where the free part
 * stops, in the reader they were already turning pages in.
 *
 * The pages are the preview alone, so the page status and the progress slider
 * count those and not the episode's full length. They are fetched as a free
 * body's are: their URLs carry the same media token, which outlasts any
 * reading, so nothing renews them.
 *
 * Nothing is recorded. The preview is not the episode, so where the reader
 * stopped in it is not a place to resume the episode from once it is bought,
 * and reaching its end is not having read the episode. The viewer opens on the
 * first page for the same reason.
 */
export const EpisodePreviewViewer = async ({
  episode,
  gate,
  nextEpisode,
  previewPages,
  previousEpisode,
  series,
}: {
  episode: EpisodeDetail;
  /** The gate's own copy and actions, turned to after the last page. */
  gate: ReactNode;
  /** Absent on the last published episode of the series. */
  nextEpisode?: EpisodeNeighborItem;
  /** At least one page: without one, the gate stands on its own. */
  previewPages: EpisodeImageItem[];
  /** Absent on the first one. */
  previousEpisode?: EpisodeNeighborItem;
  series: EpisodeSeriesSummary;
}) => {
  const locale = await getLocale();

  const [t, tenantId, accessToken] = await Promise.all([
    getMessagesFor(locale),
    getTenantId(),
    resolveAccessToken(),
  ]);

  const viewerPreferences = await getMyViewerPreferences({
    accessToken,
    tenantId,
  });

  const nextHref = nextEpisode
    ? episodePath(series.publicId, nextEpisode.publicId)
    : undefined;

  const previousHref = previousEpisode
    ? episodePath(series.publicId, previousEpisode.publicId)
    : undefined;

  return (
    // A wide viewer fills the window, and the header gives way to it.
    <div
      className={cn(VIEWER_HEIGHT_CLASS, "w-full has-data-wide-viewer:h-svh")}
    >
      <EpisodeComicViewer
        endPage={gate}
        nextEpisodeHref={nextHref}
        pages={toViewerPages(episode.title, previewPages, (values) =>
          t("storefront.episode.viewer.page_title", values)
        )}
        preview
        previousEpisodeHref={previousHref}
        readingDirection={episode.readingDirection}
        saveWideViewer={
          accessToken ? saveWideViewerAction.bind(null, tenantId) : undefined
        }
        spreadStartIndex={episode.spreadStartIndex}
        wideViewerEnabled={viewerPreferences.wideViewerEnabled}
      >
        <EpisodeNeighborKeyNavigation
          nextHref={nextHref}
          previousHref={previousHref}
        />
      </EpisodeComicViewer>
    </div>
  );
};
