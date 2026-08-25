import type { EpisodeImageItem } from "#lib/catalog";

import { VIEWER_HEIGHT_CLASS } from "../_lib/viewer-layout";
import { toViewerPages } from "../_lib/viewer-pages";
import { EpisodeBodyNotice } from "./episode-body-notice";
import { EpisodeComicViewer } from "./episode-comic-viewer";

export const EpisodeViewer = ({
  episodeTitle,
  images,
}: {
  episodeTitle: string;
  images: EpisodeImageItem[];
}) => {
  if (images.length === 0) {
    return (
      <EpisodeBodyNotice>
        <div className="rounded-3xl border border-dashed border-border/70 bg-muted/20 px-6 py-14 text-center text-muted-foreground">
          本文画像はまだ公開されていません。
        </div>
      </EpisodeBodyNotice>
    );
  }

  return (
    <div className={`${VIEWER_HEIGHT_CLASS} w-full`}>
      <EpisodeComicViewer
        episodeTitle={episodeTitle}
        pages={toViewerPages(episodeTitle, images)}
      />
    </div>
  );
};
