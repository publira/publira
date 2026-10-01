import { bindMessages } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { JsonLdSite } from "#lib/json-ld";

const { mockGetJsonLdSite } = vi.hoisted(() => ({
  mockGetJsonLdSite: vi.fn(),
}));

vi.mock("#lib/json-ld", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getJsonLdSite: mockGetJsonLdSite,
}));

// Root-parameter reads that only the Next.js compiler can provide.
vi.mock("#lib/tenant-id", () => ({
  getTenantId: () => Promise.resolve("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
}));

vi.mock("#lib/locale", () => ({
  getLocale: () => Promise.resolve("en"),
}));

vi.mock("#lib/messages", () => ({
  getMessagesFor: () => Promise.resolve(bindMessages(sharedCatalog("en"))),
}));

const { JsonLd } = await import("./json-ld");

const SITE: JsonLdSite = {
  defaultLocale: "en",
  locale: "en",
  name: "Example Comics",
  origin: "https://comics.example.test",
  tenant: { logoImageVariants: undefined },
};

/** The markup an async Server Component renders, once it has resolved. */
const renderJsonLd = async (props: Parameters<typeof JsonLd>[0]) =>
  renderToStaticMarkup(await JsonLd(props));

beforeEach(() => {
  mockGetJsonLdSite.mockResolvedValue(SITE);
});

describe("JsonLd", () => {
  it("renders the document as one JSON-LD script element", async () => {
    const html = await renderJsonLd({
      build: (site) => ({
        "@context": "https://schema.org",
        "@type": "Person",
        name: "</script><img src=x onerror=alert(1)>",
        url: site.origin,
      }),
    });

    expect(html.startsWith('<script type="application/ld+json">')).toBe(true);
    // The only `</script` is the element's own end tag.
    expect(html.match(/<\/script/giu)).toHaveLength(1);

    const text = html
      .replace('<script type="application/ld+json">', "")
      .replace("</script>", "");
    expect(JSON.parse(text)).toStrictEqual({
      "@context": "https://schema.org",
      "@type": "Person",
      name: "</script><img src=x onerror=alert(1)>",
      url: "https://comics.example.test",
    });
  });

  it("hands the builder the catalog of the page's locale", async () => {
    const html = await renderJsonLd({
      build: (_site, t) => ({
        "@context": "https://schema.org",
        "@type": "Thing",
        name: t("host.series.list_title"),
      }),
    });

    expect(html).toContain('"name":"Series"');
  });

  it("renders nothing when the tenant has no origin to write against", async () => {
    mockGetJsonLdSite.mockResolvedValue(null);
    const build = vi.fn();

    await expect(JsonLd({ build })).resolves.toBeNull();
    expect(build).not.toHaveBeenCalled();
  });
});
