import type { ViewerPage } from "@publira/comic-viewer";
import { imageServerLoader } from "@publira/utils/image-loader";

import type { EpisodeImageItem } from "#lib/catalog";

/**
 * Width of the stand-in the viewer decodes and blurs while the full page is
 * still downloading. Manael renders it from the same master, so it costs one
 * small request per page and needs no separately stored rendition.
 */
const PLACEHOLDER_WIDTH = 48;

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
 */
export const toViewerPages = (
  episodeTitle: string,
  images: EpisodeImageItem[]
): ViewerPage[] =>
  images.map((image, index) => ({
    height: positiveOrUndefined(image.height),
    id: image.id,
    mimeType: image.contentType || undefined,
    placeholder: imageServerLoader({
      src: image.imageUrl,
      width: PLACEHOLDER_WIDTH,
    }),
    src: image.imageUrl,
    title: `${episodeTitle} ${index + 1}ページ`,
    width: positiveOrUndefined(image.width),
  }));
