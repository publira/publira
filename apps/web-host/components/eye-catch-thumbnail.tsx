import { EyeCatchFrame } from "#components/eye-catch-frame";
import type { EyeCatchVariant } from "#components/eye-catch-picture";

/**
 * The small square picture at the start of a list row. The box and the
 * variant drawn into it are decided here together: the square variant is the
 * one staff frame or replace for this size in the console, and a wide image
 * cropped to the box would lose whatever sits at its left and right edges.
 * A work with no artwork keeps the flat frame, so the rows of a list stay on
 * one left edge.
 */
export const EyeCatchThumbnail = ({
  alt,
  variants,
}: {
  alt: string;
  variants: EyeCatchVariant[] | undefined;
}) => (
  <EyeCatchFrame
    alt={alt}
    className="size-14 shrink-0 rounded-control"
    preferredType="square"
    sizes="56px"
    variants={variants}
  />
);
