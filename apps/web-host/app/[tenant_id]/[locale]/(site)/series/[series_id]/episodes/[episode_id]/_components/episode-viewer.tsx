import { getMessage } from "@publira/i18n";

import type { EpisodeDetail, EpisodeImageItem } from "#lib/catalog";
import { getLocale, loadHostMessages } from "#lib/locale";

import { VIEWER_HEIGHT_CLASS } from "../_lib/viewer-layout";
import { toViewerPages } from "../_lib/viewer-pages";
import { EpisodeBodyNotice } from "./episode-body-notice";
import { EpisodeComicViewer } from "./episode-comic-viewer";
import { EpisodeReadRecorder } from "./episode-read-recorder";

export const EpisodeViewer = async ({
  episode,
  images,
}: {
  episode: EpisodeDetail;
  images: EpisodeImageItem[];
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
        pages={toViewerPages(episode.title, images, (values) =>
          getMessage(messages, "host.episode.viewer.page_title", values)
        )}
      >
        <EpisodeReadRecorder episode={episode} />
      </EpisodeComicViewer>
    </div>
  );
};
