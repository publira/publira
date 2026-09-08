import { getMessage } from "@publira/i18n";

import { resolveAccessToken } from "#lib/api-client";
import type {
  EpisodeDetail,
  EpisodeImageItem,
  EpisodeSeriesSummary,
} from "#lib/catalog";
import { getLocale, loadHostMessages } from "#lib/locale";
import { getMyReadingPosition } from "#lib/reading-position";
import { getTenantId } from "#lib/tenant-id";

import { resumePageIndex } from "../_lib/reading-position";
import { VIEWER_HEIGHT_CLASS } from "../_lib/viewer-layout";
import { toViewerPages } from "../_lib/viewer-pages";
import { EpisodeBodyNotice } from "./episode-body-notice";
import { EpisodeComicViewer } from "./episode-comic-viewer";
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
  series,
}: {
  episode: EpisodeDetail;
  images: EpisodeImageItem[];
  series: EpisodeSeriesSummary;
}) => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  if (images.length === 0) {
    return (
      <EpisodeBodyNotice>
        <div className="rounded-3xl border border-dashed border-border/70 bg-muted/20 px-6 py-14 text-center text-muted-foreground">
          {getMessage(messages, "host.episode.images_empty")}
        </div>
      </EpisodeBodyNotice>
    );
  }

  const [tenantId, accessToken] = await Promise.all([
    getTenantId(),
    resolveAccessToken(),
  ]);
  const savedPageIndex = await getMyReadingPosition({
    accessToken,
    episodePublicId: episode.publicId,
    tenantId,
  });

  return (
    <div className={`${VIEWER_HEIGHT_CLASS} w-full`}>
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
      </EpisodeComicViewer>
    </div>
  );
};
