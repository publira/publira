import type { CropRect } from "#lib/crop-rect";

/** The size of the image a rectangle is measured against, in its own pixels. */
export interface CropSource {
  width: number;
  height: number;
}

/** The ratio a frame is locked to, and the smallest cut the API accepts. */
export interface CropAspect {
  aspectWidth: number;
  aspectHeight: number;
  minWidth: number;
}

/** A corner of the frame, named after the compass point it sits at. */
export type CropCorner = "ne" | "nw" | "se" | "sw";

/**
 * What every frame of one picked file is measured against. It is built once
 * per file rather than passed around a piece at a time: the largest frame and
 * the image it fits in only mean anything together, and two rectangles side by
 * side in an argument list are two rectangles to mix up.
 */
export interface CropBounds {
  aspect: CropAspect;
  source: CropSource;
  /** The largest frame of the ratio the image can hold, centred in it. */
  largest: CropRect;
}

/**
 * Which way the frame grows when a corner is dragged: the opposite corner is
 * the anchor and stays where it is.
 */
const CORNER_GROWTH: Record<
  CropCorner,
  { growsDown: boolean; growsRight: boolean }
> = {
  ne: { growsDown: false, growsRight: true },
  nw: { growsDown: false, growsRight: false },
  se: { growsDown: true, growsRight: true },
  sw: { growsDown: true, growsRight: false },
};

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), Math.max(low, high));

/**
 * The largest rectangle of the ratio that fits in the image, centred in it.
 *
 * This is `centerCropToAspect` in `server/internal/imageproc` restated in the
 * browser, down to the rounding: it is the cut an upload carrying no rectangle
 * gets, so a frame nobody touched has to deliver exactly that image.
 */
export const centreCropRect = (
  source: CropSource,
  aspect: CropAspect
): CropRect => {
  const targetRatio = aspect.aspectWidth / aspect.aspectHeight;
  const sourceRatio = source.width / source.height;

  const fitted =
    sourceRatio > targetRatio
      ? {
          height: source.height,
          width: Math.round(source.height * targetRatio),
        }
      : {
          height: Math.round(source.width / targetRatio),
          width: source.width,
        };
  const width = Math.min(fitted.width, source.width);
  const height = Math.min(fitted.height, source.height);

  return {
    height,
    width,
    x: Math.floor((source.width - width) / 2),
    y: Math.floor((source.height - height) / 2),
  };
};

/** What a file of this size, framed for this ratio, can be moved around in. */
export const cropBounds = (
  source: CropSource,
  aspect: CropAspect
): CropBounds => ({
  aspect,
  largest: centreCropRect(source, aspect),
  source,
});

/**
 * The height that goes with a width, taken from the largest frame rather than
 * from the ratio itself. At full width the two agree exactly, which is what
 * lets an untouched frame stay the centre crop.
 */
const heightFor = ({ largest }: CropBounds, width: number): number =>
  Math.round((width * largest.height) / largest.width);

/**
 * The narrowest frame the API will still accept. An image too small to hold
 * the ratio's minimum has nothing to offer below its own largest frame, and
 * the upload is refused for the image rather than for the selection.
 */
const narrowestWidth = ({ aspect, largest }: CropBounds): number =>
  Math.min(aspect.minWidth, largest.width);

/** Puts the frame's top-left corner where it was dragged, inside the image. */
export const moveCropRect = (
  rect: CropRect,
  { source }: CropBounds,
  x: number,
  y: number
): CropRect => ({
  ...rect,
  x: clamp(Math.round(x), 0, source.width - rect.width),
  y: clamp(Math.round(y), 0, source.height - rect.height),
});

/** Resizes the frame to a width, keeping the dragged corner's opposite fixed. */
const resizeCropRect = (
  rect: CropRect,
  bounds: CropBounds,
  corner: CropCorner,
  targetWidth: number
): CropRect => {
  const { largest, source } = bounds;
  const { growsDown, growsRight } = CORNER_GROWTH[corner];
  const anchorX = growsRight ? rect.x : rect.x + rect.width;
  const anchorY = growsDown ? rect.y : rect.y + rect.height;
  const roomX = growsRight ? source.width - anchorX : anchorX;
  const roomY = growsDown ? source.height - anchorY : anchorY;

  const widest = Math.min(
    largest.width,
    roomX,
    Math.floor((roomY * largest.width) / largest.height)
  );
  const width = clamp(Math.round(targetWidth), narrowestWidth(bounds), widest);
  const height = heightFor(bounds, width);

  return {
    height,
    width,
    x: clamp(growsRight ? anchorX : anchorX - width, 0, source.width - width),
    y: clamp(growsDown ? anchorY : anchorY - height, 0, source.height - height),
  };
};

/**
 * Resizes the frame so the dragged corner follows the pointer. The frame keeps
 * its shape, so it takes whichever axis the pointer pulled further — a
 * diagonal drag would otherwise stall on the shorter one.
 */
export const resizeCropRectToPointer = (
  rect: CropRect,
  bounds: CropBounds,
  corner: CropCorner,
  pointer: { x: number; y: number }
): CropRect => {
  const { largest } = bounds;
  const { growsDown, growsRight } = CORNER_GROWTH[corner];
  const anchorX = growsRight ? rect.x : rect.x + rect.width;
  const anchorY = growsDown ? rect.y : rect.y + rect.height;
  const fromX = Math.abs(pointer.x - anchorX);
  const fromY =
    (Math.abs(pointer.y - anchorY) * largest.width) / largest.height;

  return resizeCropRect(rect, bounds, corner, Math.max(fromX, fromY));
};

/** Resizes the frame by a number of its own pixels, for keyboard steps. */
export const resizeCropRectBy = (
  rect: CropRect,
  bounds: CropBounds,
  corner: CropCorner,
  widthDelta: number
): CropRect => resizeCropRect(rect, bounds, corner, rect.width + widthDelta);
