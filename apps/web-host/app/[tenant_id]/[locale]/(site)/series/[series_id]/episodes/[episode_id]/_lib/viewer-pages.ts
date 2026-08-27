import type { ViewerPage } from "@publira/comic-viewer";

import type { EpisodeImageItem } from "#lib/catalog";

/**
 * A stored dimension of `0` means the record predates the size columns, not
 * that the page is zero pixels wide. The viewer sizes its canvas from the
 * decoded image when the page carries no dimensions, so drop them instead of
 * handing it a canvas that would draw nothing.
 */
const positiveOrUndefined = (value: number): number | undefined =>
  value > 0 ? value : undefined;

/**
 * Map episode body images onto the viewer's page list. `images` is already in
 * `displayOrder`, and that order is the reading order the viewer paginates.
 *
 * No `placeholder`: image-server resizes a page only while converting it, and
 * it decides to convert from the request's `Accept`. The viewer loads a
 * placeholder outside the plugin pipeline that sets that header, so a narrow
 * `w` on a placeholder URL is ignored and the stand-in downloads the
 * full-size original a second time. A page with nothing on screen yet shows
 * the viewer's own loading state instead.
 */
export const toViewerPages = (
  episodeTitle: string,
  images: EpisodeImageItem[],
  /** Titles one page, e.g. `{$title}, page {$page}`, from the caller's catalog. */
  formatPageTitle: (values: { page: number; title: string }) => string
): ViewerPage[] =>
  images.map((image, index) => ({
    height: positiveOrUndefined(image.height),
    id: image.id,
    mimeType: image.contentType || undefined,
    src: image.imageUrl,
    title: formatPageTitle({ page: index + 1, title: episodeTitle }),
    width: positiveOrUndefined(image.width),
  }));
