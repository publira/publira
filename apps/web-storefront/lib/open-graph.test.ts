import { describe, expect, it } from "vitest";

import type { EyeCatchImageVariant } from "./catalog";
import {
  openGraphMetadata,
  resolveEpisodeOpenGraphImage,
  resolveOpenGraphImage,
  resolveSeriesOpenGraphImage,
} from "./open-graph";

const SERIES_CARD = "/og/series/SeedSERSAAA1";
const EPISODE_CARD = "/og/series/SeedSERSAAA1/episodes/SeedEPSDAAA1";

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

describe("resolveSeriesOpenGraphImage", () => {
  it("keeps the uploaded og variant", () => {
    expect(
      resolveSeriesOpenGraphImage(
        { alt: "Published Series", variants: [variant("og", 1200, 630)] },
        SERIES_CARD
      )
    ).toEqual({
      alt: "Published Series",
      height: 630,
      url: "/images/series/00000000-0000-4000-8000-000000000000/og/1200",
      width: 1200,
    });
  });

  it("falls back to the drawn card when the series has no og variant", () => {
    expect(
      resolveSeriesOpenGraphImage(
        { alt: "Published Series", variants: [variant("portrait", 600, 800)] },
        SERIES_CARD
      )
    ).toEqual({
      alt: "Published Series",
      height: 630,
      url: SERIES_CARD,
      width: 1200,
    });
  });

  it("falls back to the drawn card when the series has no eye-catch", () => {
    expect(
      resolveSeriesOpenGraphImage(
        { alt: "Published Series", variants: undefined },
        SERIES_CARD
      ).url
    ).toBe(SERIES_CARD);
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
        { alt: "Published Series", variants: [seriesOg] },
        EPISODE_CARD
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
        { alt: "Published Series", variants: [seriesOg] },
        EPISODE_CARD
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
        { alt: "Published Series", variants: [seriesOg] },
        EPISODE_CARD
      ).url
    ).toBe(seriesOg.url);
  });

  it("falls back to the drawn card when neither has an og variant", () => {
    expect(
      resolveEpisodeOpenGraphImage(
        { alt: "Episode 2", variants: undefined },
        { alt: "Published Series", variants: undefined },
        EPISODE_CARD
      )
    ).toEqual({
      alt: "Episode 2",
      height: 630,
      url: EPISODE_CARD,
      width: 1200,
    });
  });
});

describe("openGraphMetadata", () => {
  it("gives Open Graph and X the same card", () => {
    const image = {
      alt: "Seed Label 01",
      height: 630,
      url: "/og/labels/SeedLABLAAA1",
      width: 1200,
    };

    expect(
      openGraphMetadata({
        description: "3 published series from Seed Label 01",
        image,
        siteName: "Seed Tenant",
        title: "Seed Label 01",
        type: "website",
        url: "/labels/SeedLABLAAA1",
      })
    ).toEqual({
      openGraph: {
        description: "3 published series from Seed Label 01",
        images: image,
        siteName: "Seed Tenant",
        title: "Seed Label 01",
        type: "website",
        url: "/labels/SeedLABLAAA1",
      },
      twitter: {
        card: "summary_large_image",
        description: "3 published series from Seed Label 01",
        images: image,
        title: "Seed Label 01",
      },
    });
  });
});
