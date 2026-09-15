import { describe, expect, it } from "vitest";

import type { EyeCatchImageVariant } from "./catalog";
import { resolveOpenGraphImage } from "./open-graph";

const variant = (
  variantType: string,
  width: number,
  height: number
): EyeCatchImageVariant => ({
  contentType: "image/jpeg",
  fileSizeBytes: width * height,
  height,
  label: `${variantType} ${width}`,
  url: `/images/series/00000000-0000-4000-8000-000000000000/${variantType}/${width}`,
  variantType,
  width,
});

const ORIGIN = "https://example.test";

describe("resolveOpenGraphImage", () => {
  it("picks the largest og variant and makes its path absolute", () => {
    const image = resolveOpenGraphImage(
      ORIGIN,
      [
        variant("portrait", 1200, 1600),
        variant("og", 600, 315),
        variant("og", 1200, 630),
        variant("og", 900, 473),
      ],
      "Published Series"
    );

    expect(image).toEqual({
      alt: "Published Series",
      height: 630,
      url: `${ORIGIN}/images/series/00000000-0000-4000-8000-000000000000/og/1200`,
      width: 1200,
    });
  });

  it("returns nothing when the series has no og variant", () => {
    expect(
      resolveOpenGraphImage(
        ORIGIN,
        [variant("portrait", 1200, 1600), variant("landscape", 1600, 900)],
        "Published Series"
      )
    ).toBeUndefined();
  });

  it("returns nothing when the series has no eye-catch at all", () => {
    expect(
      resolveOpenGraphImage(ORIGIN, undefined, "Published Series")
    ).toBeUndefined();
  });
});
