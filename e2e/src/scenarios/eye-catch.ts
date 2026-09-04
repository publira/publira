import path from "node:path";

/**
 * The aspect ratios an eye-catch is delivered in, and the source images the
 * console uploads for them.
 *
 * The ratios and their minimum sizes are `imageproc.EyeCatchAspects()`;
 * `apps/web-admin/components/eye-catch/aspects.ts` is the console's copy of the
 * same list. Nothing derives one ratio from another: a source is validated and
 * cropped against the ratio it was uploaded for, so every fixture here is sized
 * for exactly one slot.
 */
export const EYE_CATCH_ASPECTS = [
  "portrait",
  "square",
  "landscape",
  "og",
] as const;

export type EyeCatchAspect = (typeof EYE_CATCH_ASPECTS)[number];

const FIXTURE_DIR = path.join(import.meta.dirname, "../../fixtures/eye-catch");

/**
 * 2400x3200 — the smallest source that fills all four ratios at once, because
 * the whole eye-catch is cropped out of it and landscape needs 1600x900 to
 * survive that crop.
 */
export const EYE_CATCH_SOURCE_FIXTURE = path.join(
  FIXTURE_DIR,
  "source-2400x3200.jpg"
);

/**
 * One source per ratio, each at that ratio's minimum and each a different
 * picture, so a replacement can be told from what it replaced by its bytes.
 */
export const EYE_CATCH_ASPECT_FIXTURES: Record<EyeCatchAspect, string> = {
  landscape: path.join(FIXTURE_DIR, "landscape-1600x900.jpg"),
  og: path.join(FIXTURE_DIR, "og-1200x630.jpg"),
  portrait: path.join(FIXTURE_DIR, "portrait-1200x1600.jpg"),
  square: path.join(FIXTURE_DIR, "square-1200x1200.jpg"),
};

/** 600x800 — the right shape for portrait, below its 1200x1600 minimum. */
export const EYE_CATCH_UNDERSIZED_ASPECT = "portrait" as const;

export const EYE_CATCH_UNDERSIZED_FIXTURE = path.join(
  FIXTURE_DIR,
  "portrait-600x800.jpg"
);
