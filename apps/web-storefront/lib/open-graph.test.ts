import { describe, expect, it } from "vitest";

import type { EyeCatchImageVariant } from "./catalog";
import {
  resolveEpisodeOpenGraphImage,
  resolveOpenGraphImage,
} from "./open-graph";

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

describe("resolveOpenGraphImage", () => {
  it("picks the largest og variant", () => {
    const image = resolveOpenGraphImage(
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
      url: `/images/series/00000000-0000-4000-8000-000000000000/og/1200`,
      width: 1200,
    });
  });

  it("returns nothing when the series has no og variant", () => {
    expect(
      resolveOpenGraphImage(
        [variant("portrait", 1200, 1600), variant("landscape", 1600, 900)],
        "Published Series"
      )
    ).toBeUndefined();
  });

  it("returns nothing when the series has no eye-catch at all", () => {
    expect(
      resolveOpenGraphImage(undefined, "Published Series")
    ).toBeUndefined();
  });
});

describe("resolveEpisodeOpenGraphImage", () => {
  const seriesOg = {
    contentType: "image/jpeg",
    fileSizeBytes: 1200 * 630,
    height: 630,
    label: "og 1200",
    url: "/images/series/00000000-0000-4000-8000-000000000000/og/1200",
    variantType: "og",
    width: 1200,
  };
  const episodeOg = {
    ...seriesOg,
    url: "/images/episode-eye-catches/00000000-0000-4000-8000-000000000001/og/1200",
  };

  it("uses the episode's own og variant", () => {
    expect(
      resolveEpisodeOpenGraphImage(
        { alt: "Episode 2", variants: [episodeOg] },
        { alt: "Published Series", variants: [seriesOg] }
      )
    ).toEqual({
      alt: "Episode 2",
      height: 630,
      url: episodeOg.url,
      width: 1200,
    });
  });

  it("falls back to the series' when the episode has no eye-catch", () => {
    expect(
      resolveEpisodeOpenGraphImage(
        { alt: "Episode 2", variants: undefined },
        { alt: "Published Series", variants: [seriesOg] }
      )
    ).toEqual({
      alt: "Published Series",
      height: 630,
      url: seriesOg.url,
      width: 1200,
    });
  });

  it("falls back to the series' when the episode's eye-catch has no og variant", () => {
    expect(
      resolveEpisodeOpenGraphImage(
        { alt: "Episode 2", variants: [variant("landscape", 1600, 900)] },
        { alt: "Published Series", variants: [seriesOg] }
      )?.url
    ).toBe(seriesOg.url);
  });

  it("returns nothing when neither has an og variant", () => {
    expect(
      resolveEpisodeOpenGraphImage(
        { alt: "Episode 2", variants: undefined },
        { alt: "Published Series", variants: undefined }
      )
    ).toBeUndefined();
  });
});
