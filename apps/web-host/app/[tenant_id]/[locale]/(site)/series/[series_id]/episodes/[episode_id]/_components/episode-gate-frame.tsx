import { cn } from "@publira/utils";
import type { ReactNode } from "react";

import type { EpisodeDetail, EpisodeImageItem } from "#lib/catalog";

import { VIEWER_MIN_HEIGHT_CLASS } from "../_lib/viewer-layout";

/**
 * What stands where the reader would be when a gate closes the body: the
 * reader's own dark box, the opening pages laid into it, and the gate's card
 * floating over them. The reader sees the work they are being asked about
 * rather than a description of it.
 *
 * The pages are the server's renditions, blurred before they leave it, and
 * nothing here blurs them again or could unblur them: the full page is never
 * sent, so no element on this screen holds one. They are drawn as they come,
 * as plain images, because the image route ignores the width a `srcset` would
 * ask for. They are decoration beside the card, which says everything the
 * reader needs, so assistive technology is told nothing about them.
 *
 * Two pages side by side are a spread, so a right-to-left work puts the first
 * one on the right. A phone has room for one, and shows the first.
 */
export const EpisodeGateFrame = ({
  children,
  previewImages,
  readingDirection,
}: {
  /** The gate's own copy and actions. */
  children: ReactNode;
  previewImages: EpisodeImageItem[];
  readingDirection: EpisodeDetail["readingDirection"];
}) => (
  <div
    className={cn(
      VIEWER_MIN_HEIGHT_CLASS,
      "relative isolate grid w-full place-items-center overflow-hidden bg-foreground px-4 py-10"
    )}
  >
    {previewImages.length > 0 ? (
      <div
        aria-hidden="true"
        className={cn(
          "absolute inset-0 -z-10 flex justify-center",
          readingDirection === "rtl" && "flex-row-reverse"
        )}
      >
        {previewImages.map((image, index) => (
          // The rendition is one size, so there is no `srcset` for next/image
          // to build and no width for its loader to ask for.
          // oxlint-disable-next-line next/no-img-element, react-doctor/nextjs-no-img-element
          <img
            alt=""
            className={cn(
              "h-full w-auto max-w-1/2 min-w-0 object-cover max-sm:max-w-full",
              index > 0 && "max-sm:hidden"
            )}
            decoding="async"
            height={image.height}
            key={image.id}
            src={image.imageUrl}
            width={image.width}
          />
        ))}
      </div>
    ) : null}
    <div className="w-full max-w-xl rounded-surface bg-background p-6 text-center text-foreground shadow-floating sm:p-8">
      {children}
    </div>
  </div>
);
