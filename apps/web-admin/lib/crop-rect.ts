/**
 * The rectangle an upload form states alongside an image, shared by every
 * console control that lets an editor frame one.
 *
 * It is `publira.types.v1.ImageCropRect`: pixels of the image it travels with,
 * origin at that image's top-left corner. Nothing records which image it was
 * measured against, so it means nothing on its own.
 */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The rectangle crosses a form as one field spelled `x,y,width,height` rather
 * than as four. A control that posted four fields could lose one of them on
 * the way, and a rectangle missing a side would cut somewhere the editor never
 * framed; one field either states a whole rectangle or states none.
 */
export const CROP_RECT_FIELD = "crop";

/**
 * Four decimal integers, the last two of them positive: a rectangle with no
 * width or height names nothing to keep.
 */
const CROP_RECT_PATTERN = /^\d+,\d+,[1-9]\d*,[1-9]\d*$/u;

export const formatCropRect = (rect: CropRect): string =>
  `${rect.x},${rect.y},${rect.width},${rect.height}`;

/**
 * The rectangle a field holds, or `undefined` for anything that is not one —
 * an empty field above all, which is how a form says it framed nothing and
 * leaves the cut in the centre of the upload.
 */
export const parseCropRect = (value: string): CropRect | undefined => {
  const trimmed = value.trim();
  if (!CROP_RECT_PATTERN.test(trimmed)) {
    return;
  }
  const [x, y, width, height] = trimmed.split(",").map(Number);
  return { height, width, x, y };
};

/** Whether a field holds either a whole rectangle or nothing at all. */
export const isCropRectField = (value: string): boolean => {
  const trimmed = value.trim();
  return trimmed === "" || CROP_RECT_PATTERN.test(trimmed);
};
