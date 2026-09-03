/**
 * The aspect ratios an eye-catch is delivered in, in the order the console
 * shows them. This mirrors `imageproc.EyeCatchAspects()` on the API side: the
 * ratio keys are the `variant_type` values the RPCs accept, and the minimums
 * are the sizes an image uploaded for that ratio has to meet.
 */
export const EYE_CATCH_ASPECTS = [
  {
    aspectClassName: "aspect-3/4",
    minHeight: 1600,
    minWidth: 1200,
    variantType: "portrait",
  },
  {
    aspectClassName: "aspect-square",
    minHeight: 1200,
    minWidth: 1200,
    variantType: "square",
  },
  {
    aspectClassName: "aspect-video",
    minHeight: 900,
    minWidth: 1600,
    variantType: "landscape",
  },
  {
    aspectClassName: "aspect-1200/630",
    minHeight: 630,
    minWidth: 1200,
    variantType: "og",
  },
] as const;

export type EyeCatchAspect = (typeof EYE_CATCH_ASPECTS)[number];

const ASPECT_CLASS_NAMES = new Map<string, string>(
  EYE_CATCH_ASPECTS.map((aspect) => [
    aspect.variantType,
    aspect.aspectClassName,
  ])
);

/**
 * The Tailwind aspect-ratio class for a ratio key. A key the API starts
 * delivering before this list learns about it falls back to 4:3, which reads
 * as an unfamiliar shape rather than as a broken layout.
 */
export const eyeCatchAspectClassName = (variantType: string): string =>
  ASPECT_CLASS_NAMES.get(variantType) ?? "aspect-4/3";

const ASPECT_ORDER: string[] = EYE_CATCH_ASPECTS.map(
  (aspect) => aspect.variantType
);

/** Sort key for a ratio, putting unknown keys after the known ones. */
export const eyeCatchAspectOrder = (variantType: string): number => {
  const index = ASPECT_ORDER.indexOf(variantType);
  return index === -1 ? ASPECT_ORDER.length : index;
};
