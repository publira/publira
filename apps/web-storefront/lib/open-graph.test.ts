import { describe, expect, it } from "vitest";

import type { EyeCatchImageVariant } from "./catalog";
import {
  descriptionFromBody,
  openGraphMetadata,
  pageOpenGraphMetadata,
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
  fileSizeBytes: BigInt(width * height),
  label: `${variantType} ${width}`,
  url: `/images/series/00000000-0000-4000-8000-000000000000/${variantType}/${width}`,
  height,
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
        {
          ageRating: undefined,
          alt: "Published Series",
          variants: [variant("og", 1200, 630)],
        },
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
        {
          ageRating: undefined,
          alt: "Published Series",
          variants: [variant("portrait", 600, 800)],
        },
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
        { ageRating: undefined, alt: "Published Series", variants: undefined },
        SERIES_CARD
      ).url
    ).toBe(SERIES_CARD);
  });

  it.each(["r15", "r18"] as const)(
    "draws the card for a series rated %s, whatever it uploaded",
    (ageRating) => {
      expect(
        resolveSeriesOpenGraphImage(
          {
            ageRating,
            alt: "Published Series",
            variants: [variant("og", 1200, 630)],
          },
          SERIES_CARD
        )
      ).toEqual({
        alt: "Published Series",
        height: 630,
        url: SERIES_CARD,
        width: 1200,
      });
    }
  );
});

describe("resolveEpisodeOpenGraphImage", () => {
  const seriesOg = {
    contentType: "image/jpeg",
    fileSizeBytes: 1200n * 630n,
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
        { ageRating: undefined, alt: "Published Series", variants: [seriesOg] },
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
        { ageRating: undefined, alt: "Published Series", variants: [seriesOg] },
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
        { ageRating: undefined, alt: "Published Series", variants: [seriesOg] },
        EPISODE_CARD
      ).url
    ).toBe(seriesOg.url);
  });

  it("falls back to the drawn card when neither has an og variant", () => {
    expect(
      resolveEpisodeOpenGraphImage(
        { alt: "Episode 2", variants: undefined },
        { ageRating: undefined, alt: "Published Series", variants: undefined },
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

describe("resolveEpisodeOpenGraphImage of a rated series", () => {
  const og = variant("og", 1200, 630);

  it.each(["r15", "r18"] as const)(
    "draws the card for an episode of a series rated %s, whatever either uploaded",
    (ageRating) => {
      expect(
        resolveEpisodeOpenGraphImage(
          { alt: "Episode 2", variants: [og] },
          { ageRating, alt: "Published Series", variants: [og] },
          EPISODE_CARD
        )
      ).toEqual({
        alt: "Episode 2",
        height: 630,
        url: EPISODE_CARD,
        width: 1200,
      });
    }
  );
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
        image,
        description: "3 published series from Seed Label 01",
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

describe("pageOpenGraphMetadata", () => {
  const site = {
    description: "Comics from the Seed Tenant",
    image: {
      alt: "Seed Tenant",
      height: 630,
      url: "/og",
      width: 1200,
    },
    siteName: "Seed Tenant",
  };

  const alternates = {
    canonical: "/ja/genres",
    languages: { en: "/genres", ja: "/ja/genres", "x-default": "/genres" },
  };

  it("names the page's own title and canonical URL on the site's picture", () => {
    expect(
      pageOpenGraphMetadata({
        alternates,
        site,
        description: "The genres published on Seed Tenant",
        title: "Genres",
      })
    ).toEqual({
      openGraph: {
        description: "The genres published on Seed Tenant",
        images: site.image,
        siteName: "Seed Tenant",
        title: "Genres",
        type: "website",
        url: "/ja/genres",
      },
      twitter: {
        card: "summary_large_image",
        description: "The genres published on Seed Tenant",
        images: site.image,
        title: "Genres",
      },
    });
  });

  it("carries the site's description where the page has none", () => {
    const { openGraph, twitter } = pageOpenGraphMetadata({
      alternates,
      site,
      title: "Genres",
    });

    expect(openGraph?.description).toBe(site.description);
    expect(twitter?.description).toBe(site.description);
  });

  it("names no URL without alternates", () => {
    expect(
      pageOpenGraphMetadata({ site, alternates: undefined, title: "Genres" })
        .openGraph?.url
    ).toBeUndefined();
  });
});

describe("descriptionFromBody", () => {
  it("joins the lines of a short body into one", () => {
    expect(
      descriptionFromBody(
        "  Maintenance tonight.\n\nThe site  pauses at 2:00. "
      )
    ).toBe("Maintenance tonight. The site pauses at 2:00.");
  });

  it("returns nothing for a blank body", () => {
    expect(descriptionFromBody(" \n\t ")).toBeUndefined();
  });

  it("keeps a body of exactly 200 characters whole", () => {
    const body = "a".repeat(200);

    expect(descriptionFromBody(body)).toBe(body);
  });

  it("cuts a longer body with an ellipsis, 200 characters in all", () => {
    const description = descriptionFromBody(`${"a".repeat(198)} bcd`) ?? "";

    expect(description).toBe(`${"a".repeat(198)}…`);
  });

  it("counts an emoji sequence as one character and never splits it", () => {
    const family = "👨‍👩‍👧";
    const description = descriptionFromBody(family.repeat(250)) ?? "";

    expect(description).toBe(`${family.repeat(199)}…`);
  });
});
