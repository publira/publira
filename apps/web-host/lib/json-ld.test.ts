import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EyeCatchImageVariant } from "./catalog";
import type { JsonLdSite } from "./json-ld";

const getTenantPublicOrigin = vi.fn();
const getTenantSiteInfo = vi.fn();
const getTenantSiteLabel = vi.fn();

vi.mock("./tenant", () => ({
  getTenantPublicOrigin,
  getTenantSiteInfo,
  getTenantSiteLabel,
}));

const {
  breadcrumbJsonLd,
  creatorJsonLd,
  episodeJsonLd,
  getJsonLdSite,
  jsonLdUrl,
  organizationJsonLd,
  serializeJsonLd,
  seriesJsonLd,
  websiteJsonLd,
} = await import("./json-ld");

const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const ORIGIN = "https://comics.example.test";

/** A page served in the tenant's default locale, so its paths carry no prefix. */
const SITE: JsonLdSite = {
  defaultLocale: "en",
  locale: "en",
  name: "Example Comics",
  origin: ORIGIN,
};

/** The same site read in another locale, whose paths carry its prefix. */
const JAPANESE_SITE: JsonLdSite = { ...SITE, locale: "ja" };

const variant = (
  variantType: string,
  width: number,
  url: string
): EyeCatchImageVariant => ({
  contentType: "image/webp",
  fileSizeBytes: 1,
  height: width,
  label: `${variantType}-${width}`,
  url,
  variantType,
  width,
});

const SERIES = {
  credits: [
    { name: "Jane Doe", publicId: "CREATOR01", roleName: "Story" },
    { name: "John Roe", publicId: "CREATOR02", roleName: "Art" },
  ],
  eyeCatchImageVariants: undefined,
  genres: [{ name: "Fantasy", publicId: "GENRE01" }],
  labelName: "",
  labelPublicId: "",
  publicId: "SERIES01",
  ratingAverage: 4.2,
  ratingCount: 31,
  synopsis: "A long road home.",
  tags: [{ name: "Dragons", slug: "dragons" }],
  title: "The Long Road",
} satisfies Parameters<typeof seriesJsonLd>[1];

const EPISODE = {
  credits: [{ name: "Jane Doe", publicId: "CREATOR01", roleName: "Story" }],
  orderIndex: 3,
  publicId: "EPISODE03",
  publishedAt: "2026-09-01T03:00:00Z",
  title: "The Bridge",
};

beforeEach(() => {
  getTenantPublicOrigin.mockResolvedValue(ORIGIN);
  getTenantSiteInfo.mockResolvedValue({ defaultLocale: "en" });
  getTenantSiteLabel.mockResolvedValue("Example Comics");
});

describe("getJsonLdSite", () => {
  it("names the tenant's origin, both locales, and the site", async () => {
    await expect(getJsonLdSite(TENANT_ID, "ja")).resolves.toStrictEqual({
      defaultLocale: "en",
      locale: "ja",
      name: "Example Comics",
      origin: ORIGIN,
    });
  });

  it("answers with nothing when the tenant has no origin to write against", async () => {
    getTenantPublicOrigin.mockResolvedValue(null);

    await expect(getJsonLdSite(TENANT_ID, "en")).resolves.toBeNull();
    expect(getTenantSiteLabel).not.toHaveBeenCalled();
  });

  it("answers with nothing when the tenant read is unavailable", async () => {
    getTenantSiteInfo.mockResolvedValue(null);

    await expect(getJsonLdSite(TENANT_ID, "en")).resolves.toBeNull();
  });
});

describe("jsonLdUrl", () => {
  it("writes the root as the bare origin, the way the canonical link is written", () => {
    expect(jsonLdUrl(SITE, "/")).toBe(ORIGIN);
  });

  it("prefixes a locale that is not the tenant's default", () => {
    expect(jsonLdUrl(JAPANESE_SITE, "/")).toBe(`${ORIGIN}/ja`);
    expect(jsonLdUrl(JAPANESE_SITE, "/series/SERIES01")).toBe(
      `${ORIGIN}/ja/series/SERIES01`
    );
  });
});

describe("websiteJsonLd", () => {
  it("names the site in the language its URL serves", () => {
    expect(websiteJsonLd(JAPANESE_SITE)).toStrictEqual({
      "@context": "https://schema.org",
      "@id": `${ORIGIN}/ja#website`,
      "@type": "WebSite",
      inLanguage: "ja",
      name: "Example Comics",
      publisher: { "@id": `${ORIGIN}/ja#organization` },
      url: `${ORIGIN}/ja`,
    });
  });
});

describe("organizationJsonLd", () => {
  it("makes the logo absolute and lists the app store listings as sameAs", () => {
    const document = organizationJsonLd(SITE, {
      appStoreUrl: "https://apps.apple.com/app/id000000000",
      googlePlayUrl: "https://play.google.com/store/apps/details?id=test.app",
      logoImageVariants: [
        {
          contentType: "image/png",
          fileSizeBytes: 1,
          height: 60,
          label: "logo",
          url: "/images/tenant/logo.png",
          variantType: "logo",
          width: 240,
        },
      ],
    });

    expect(document).toMatchObject({
      "@id": `${ORIGIN}#organization`,
      "@type": "Organization",
      logo: `${ORIGIN}/images/tenant/logo.png`,
      name: "Example Comics",
      sameAs: [
        "https://apps.apple.com/app/id000000000",
        "https://play.google.com/store/apps/details?id=test.app",
      ],
      url: ORIGIN,
    });
  });

  it("leaves out a logo and sameAs the tenant has not set", () => {
    const document = organizationJsonLd(SITE, {
      logoImageVariants: undefined,
    });

    expect(document).not.toHaveProperty("logo");
    expect(document).not.toHaveProperty("sameAs");
  });
});

describe("seriesJsonLd", () => {
  it("describes the work at its canonical URL", () => {
    expect(seriesJsonLd(SITE, SERIES)).toStrictEqual({
      "@context": "https://schema.org",
      "@id": `${ORIGIN}/series/SERIES01#series`,
      "@type": "ComicSeries",
      aggregateRating: {
        "@type": "AggregateRating",
        bestRating: 5,
        ratingCount: 31,
        ratingValue: 4.2,
        worstRating: 1,
      },
      author: [
        {
          "@id": `${ORIGIN}/creators/CREATOR01#person`,
          "@type": "Person",
          name: "Jane Doe",
          url: `${ORIGIN}/creators/CREATOR01`,
        },
        {
          "@id": `${ORIGIN}/creators/CREATOR02#person`,
          "@type": "Person",
          name: "John Roe",
          url: `${ORIGIN}/creators/CREATOR02`,
        },
      ],
      description: "A long road home.",
      genre: ["Fantasy"],
      keywords: ["Dragons"],
      name: "The Long Road",
      publisher: {
        "@id": `${ORIGIN}#organization`,
        "@type": "Organization",
        name: "Example Comics",
        url: ORIGIN,
      },
      url: `${ORIGIN}/series/SERIES01`,
    });
  });

  it("carries no aggregateRating for a work nobody has rated", () => {
    const document = seriesJsonLd(SITE, {
      ...SERIES,
      ratingAverage: 0,
      ratingCount: 0,
    });

    expect(document).not.toHaveProperty("aggregateRating");
  });

  it("makes each image absolute, the largest of each ratio a search engine crops", () => {
    const eyeCatchImageVariants = [
      variant("portrait", 600, "/images/series/portrait-600.webp"),
      variant("portrait", 1200, "/images/series/portrait-1200.webp"),
      variant("landscape", 1600, "/images/series/landscape-1600.webp"),
      variant("og", 1200, "/images/series/og-1200.webp"),
    ];

    const document = seriesJsonLd(SITE, { ...SERIES, eyeCatchImageVariants });

    expect(document.image).toStrictEqual([
      `${ORIGIN}/images/series/landscape-1600.webp`,
      `${ORIGIN}/images/series/portrait-1200.webp`,
    ]);
  });

  it("names the label as the publisher where the work is filed under one", () => {
    const document = seriesJsonLd(SITE, {
      ...SERIES,
      labelName: "Night Shelf",
      labelPublicId: "LABEL01",
    });

    expect(document.publisher).toStrictEqual({
      "@type": "Organization",
      name: "Night Shelf",
      url: `${ORIGIN}/labels/LABEL01`,
    });
  });

  it("credits a creator who holds two roles once", () => {
    const document = seriesJsonLd(SITE, {
      ...SERIES,
      credits: [
        { name: "Jane Doe", publicId: "CREATOR01", roleName: "Story" },
        { name: "Jane Doe", publicId: "CREATOR01", roleName: "Art" },
      ],
    });

    expect(document.author).toHaveLength(1);
  });

  it("leaves out a description the tenant has not written", () => {
    const document = seriesJsonLd(SITE, { ...SERIES, synopsis: "  " });

    expect(document).not.toHaveProperty("description");
  });
});

describe("episodeJsonLd", () => {
  const series = { publicId: "SERIES01", title: "The Long Road" };

  it("describes the episode as an issue of the work it belongs to", () => {
    expect(
      episodeJsonLd(JAPANESE_SITE, { access: "free", episode: EPISODE, series })
    ).toStrictEqual({
      "@context": "https://schema.org",
      "@id": `${ORIGIN}/ja/series/SERIES01/episodes/EPISODE03#issue`,
      "@type": "ComicIssue",
      author: [
        {
          "@id": `${ORIGIN}/ja/creators/CREATOR01#person`,
          "@type": "Person",
          name: "Jane Doe",
          url: `${ORIGIN}/ja/creators/CREATOR01`,
        },
      ],
      datePublished: "2026-09-01T03:00:00Z",
      isAccessibleForFree: true,
      isPartOf: {
        "@id": `${ORIGIN}/ja/series/SERIES01#series`,
        "@type": "ComicSeries",
        name: "The Long Road",
        url: `${ORIGIN}/ja/series/SERIES01`,
      },
      issueNumber: 3,
      name: "The Bridge",
      url: `${ORIGIN}/ja/series/SERIES01/episodes/EPISODE03`,
    });
  });

  it("marks a locked episode as not free", () => {
    const document = episodeJsonLd(SITE, {
      access: "locked",
      episode: EPISODE,
      series,
    });

    expect(document.isAccessibleForFree).toBe(false);
  });

  it("states nothing about the price of an episode the age rule withholds", () => {
    const document = episodeJsonLd(SITE, {
      access: "age_restricted",
      episode: EPISODE,
      series,
    });

    expect(document).not.toHaveProperty("isAccessibleForFree");
  });
});

describe("creatorJsonLd", () => {
  it("describes the person the creator page is about", () => {
    expect(
      creatorJsonLd(SITE, {
        iconImageUrl: "/images/creators/CREATOR01.webp",
        id: "CREATOR01",
        name: "Jane Doe",
        profileText: "Draws dragons.",
      })
    ).toStrictEqual({
      "@context": "https://schema.org",
      "@id": `${ORIGIN}/creators/CREATOR01#profile`,
      "@type": "ProfilePage",
      mainEntity: {
        "@id": `${ORIGIN}/creators/CREATOR01#person`,
        "@type": "Person",
        description: "Draws dragons.",
        image: `${ORIGIN}/images/creators/CREATOR01.webp`,
        name: "Jane Doe",
        url: `${ORIGIN}/creators/CREATOR01`,
      },
      url: `${ORIGIN}/creators/CREATOR01`,
    });
  });
});

describe("breadcrumbJsonLd", () => {
  it("starts the trail at the top page and numbers every step", () => {
    expect(
      breadcrumbJsonLd(JAPANESE_SITE, [
        { href: "/creators", name: "Authors" },
        { href: "/creators/CREATOR01", name: "Jane Doe" },
      ])
    ).toStrictEqual({
      "@context": "https://schema.org",
      "@id": `${ORIGIN}/ja/creators/CREATOR01#breadcrumb`,
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          item: `${ORIGIN}/ja`,
          name: "Example Comics",
          position: 1,
        },
        {
          "@type": "ListItem",
          item: `${ORIGIN}/ja/creators`,
          name: "Authors",
          position: 2,
        },
        {
          "@type": "ListItem",
          item: `${ORIGIN}/ja/creators/CREATOR01`,
          name: "Jane Doe",
          position: 3,
        },
      ],
    });
  });
});

describe("serializeJsonLd", () => {
  const document = seriesJsonLd(SITE, {
    ...SERIES,
    synopsis: "</script><script>alert(1)</script>",
  });

  it("never lets tenant text close the script element", () => {
    const text = serializeJsonLd(document);

    expect(text).not.toContain("<");
    expect(text).toContain("\\u003c/script>");
  });

  it("parses back to the document it was given", () => {
    expect(JSON.parse(serializeJsonLd(document))).toStrictEqual(document);
  });
});
