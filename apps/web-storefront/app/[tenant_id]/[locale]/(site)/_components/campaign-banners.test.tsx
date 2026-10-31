// @vitest-environment jsdom

import { cleanup, fireEvent, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StorefrontMessagesContextProvider } from "#components/storefront-messages-context";
import type { CampaignBannerItem } from "#lib/campaign-banners";
import { loadStorefrontClientMessages } from "#lib/messages";
import { renderWithClientMessages } from "#lib/render-with-client-messages";

import { CampaignBannersSection } from "./campaign-banners";

const { mockListCampaignBanners } = vi.hoisted(() => ({
  mockListCampaignBanners: vi.fn(),
}));

vi.mock("#lib/campaign-banners", () => ({
  listCampaignBanners: mockListCampaignBanners,
}));

// `getTenantId()` and `getLocale()` are root-parameter reads that only the
// Next.js compiler can provide. The catalog is the real one, so the assertions
// stay on the copy a reader actually hears.
vi.mock("#lib/tenant-id", () => ({
  getTenantId: () => Promise.resolve("11111111-1111-4111-8111-111111111111"),
}));

vi.mock("#lib/locale", () => ({
  getLocale: () => Promise.resolve("en"),
}));

vi.mock("#components/locale-context", () => ({
  useLocale: () => "en",
  useTenantDefaultLocale: () => "ja",
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: { children: ReactNode; href: string } & ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

/** jsdom implements no scrolling; the strip's own calls are what is asserted. */
const scrollTo = vi.fn();

beforeEach(() => {
  mockListCampaignBanners.mockReset();
  scrollTo.mockReset();
  HTMLElement.prototype.scrollTo = scrollTo;
});

const banner = (
  publicId: string,
  linkUrl = `/series/${publicId}`,
  altText = ""
): CampaignBannerItem => ({
  altText,
  imageVariants: [
    {
      contentType: "image/webp",
      fileSizeBytes: 1024,
      height: 450,
      label: "800w",
      url: `https://cdn.example.com/${publicId}/landscape-800.webp`,
      variantType: "landscape",
      width: 800,
    },
  ],
  linkUrl,
  publicId,
});

const renderSection = async (banners: CampaignBannerItem[]) => {
  mockListCampaignBanners.mockResolvedValueOnce(banners);
  const element = await CampaignBannersSection();

  return element ? await renderWithClientMessages(element) : null;
};

describe("CampaignBannersSection", () => {
  // The top page of a tenant that schedules nothing must stay the page it was:
  // no heading, no band, and no element to keep space for one.
  it("draws nothing at all when no banner is showing", async () => {
    await expect(renderSection([])).resolves.toBeNull();
  });

  it("draws one banner as one link, with nothing to operate", async () => {
    await renderSection([banner("BANNER01")]);

    const region = screen.getByRole("region", { name: "Campaigns" });
    expect(
      screen.getByRole("link", { name: "Campaign banner" }).getAttribute("href")
    ).toBe("/en/series/BANNER01");
    expect(region.querySelectorAll("button")).toHaveLength(0);
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("links an absolute URL where the operator pointed it", async () => {
    await renderSection([banner("BANNER01", "https://example.com/campaign")]);

    expect(
      screen.getByRole("link", { name: "Campaign banner" }).getAttribute("href")
    ).toBe("https://example.com/campaign");
  });

  // The image is all the link holds, so the words drawn into it are what a
  // screen reader announces the banner by.
  it("names a banner's link by the alternative text the operator wrote", async () => {
    await renderSection([
      banner("BANNER01", undefined, "Autumn sale: the first volume is free"),
    ]);

    expect(
      screen
        .getByRole("link", { name: "Autumn sale: the first volume is free" })
        .getAttribute("href")
    ).toBe("/en/series/BANNER01");
  });

  it("names each banner of a strip by its own text, and one without by the generic name", async () => {
    await renderSection([
      banner("BANNER01", undefined, "Autumn sale"),
      banner("BANNER02"),
    ]);

    expect(
      screen
        .getAllByRole("listitem")
        .map((item) => item.querySelector("img")?.getAttribute("alt"))
    ).toEqual(["Autumn sale", "Campaign banner"]);
  });

  it("draws two or more as a list in the operator's order, with controls", async () => {
    await renderSection([
      banner("BANNER01"),
      banner("BANNER02"),
      banner("BANNER03"),
    ]);

    const items = screen.getAllByRole("listitem");
    expect(
      items.map((item) => item.querySelector("a")?.getAttribute("href"))
    ).toEqual([
      "/en/series/BANNER01",
      "/en/series/BANNER02",
      "/en/series/BANNER03",
    ]);
    expect(
      screen.getByRole("button", { name: "Previous campaign" })
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Next campaign" })).toBeDefined();
  });

  // The band is what a reader sees first, so only its first image competes for
  // the network ahead of the rest of the page.
  it("fetches the first banner's image first and the rest when they come near", async () => {
    await renderSection([banner("BANNER01"), banner("BANNER02")]);

    const images = screen.getAllByRole("img");
    expect(images.map((image) => image.getAttribute("loading"))).toEqual([
      "eager",
      "lazy",
    ]);
    expect(images[0]?.getAttribute("fetchpriority")).toBe("high");
  });
});

/**
 * jsdom lays nothing out, so the strip is given one slide per view: the copy
 * of the last banner at 0, the three banners at 300, 600, and 900, and the
 * copy of the first at 1200.
 */
const layOut = (track: HTMLElement, slideWidth: number) => {
  Object.defineProperty(track, "clientWidth", { value: slideWidth });

  for (const [index, slide] of [...track.children].entries()) {
    Object.defineProperty(slide, "offsetLeft", {
      value: index * slideWidth,
    });
    Object.defineProperty(slide, "offsetWidth", { value: slideWidth });
  }
};

const threeBanners = () => [
  banner("BANNER01"),
  banner("BANNER02"),
  banner("BANNER03"),
];

const renderStrip = async () => {
  await renderSection(threeBanners());
  const track = screen.getByRole("list");
  layOut(track, 300);

  return { track };
};

describe("CampaignBannerCarousel", () => {
  // Until the page has run its script, the strip cannot carry a reader past
  // either end, so the markup the server sends is the plain list, opened on
  // the first banner, with no copy for the first screen to show instead.
  it("sends the plain strip from the server, with no copy at either end", async () => {
    mockListCampaignBanners.mockResolvedValueOnce(threeBanners());
    const element = await CampaignBannersSection();
    const loaded = await loadStorefrontClientMessages("en");

    const messages = Object.assign(Promise.resolve(loaded), {
      status: "fulfilled",
      value: loaded,
    });

    const markup = renderToString(
      <StorefrontMessagesContextProvider messages={messages}>
        {element}
      </StorefrontMessagesContextProvider>
    );

    // `<li ` rather than `<li`, which a preloaded image's `<link>` matches too.
    expect(markup.match(/<li[\s>]/gu)).toHaveLength(3);
    expect(markup).not.toContain("inert");
  });

  it("puts a copy at each end that a screen reader and the tab order skip", async () => {
    const { track } = await renderStrip();

    const copies = track.querySelectorAll("li[inert]");
    expect(copies).toHaveLength(2);

    for (const copy of copies) {
      expect(copy.getAttribute("aria-hidden")).toBe("true");
    }

    expect(copies[0]?.querySelector("a")?.getAttribute("href")).toBe(
      "/en/series/BANNER03"
    );
    expect(copies[1]?.querySelector("a")?.getAttribute("href")).toBe(
      "/en/series/BANNER01"
    );
    // The copy before the first banner pushed it along, so the strip is put
    // back onto it at once rather than gliding there.
    expect(scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "instant" })
    );
    expect(screen.getByText("1 / 3")).toBeDefined();
  });

  it("scrolls the strip to the next banner rather than keeping a position of its own", async () => {
    const { track } = await renderStrip();
    track.scrollLeft = 300;
    scrollTo.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Next campaign" }));

    expect(scrollTo).toHaveBeenCalledWith({ left: 600 });
    // The counter follows the scroll, not the press.
    expect(screen.getByText("1 / 3")).toBeDefined();
  });

  // A press lands while the glide of the one before it is still under way, so
  // aiming from where the strip is would aim at the same banner twice.
  it("moves on again for a second press made before the strip comes to rest", async () => {
    const { track } = await renderStrip();
    track.scrollLeft = 300;
    scrollTo.mockClear();

    const next = screen.getByRole("button", { name: "Next campaign" });
    fireEvent.click(next);
    fireEvent.click(next);

    expect(scrollTo).toHaveBeenLastCalledWith({ left: 900 });
  });

  // The jump off a copy ends a scroll of its own, and that end can arrive
  // after the next press has already aimed the strip somewhere else.
  it("keeps aiming where a press aimed it when the strip rests short of there", async () => {
    const { track } = await renderStrip();
    track.scrollLeft = 300;
    scrollTo.mockClear();

    const next = screen.getByRole("button", { name: "Next campaign" });
    fireEvent.click(next);
    fireEvent(track, new Event("scrollend"));
    fireEvent.click(next);

    expect(scrollTo).toHaveBeenLastCalledWith({ left: 900 });
  });

  it("forgets where a press aimed it once the reader takes the strip in hand", async () => {
    const { track } = await renderStrip();
    track.scrollLeft = 300;
    scrollTo.mockClear();

    const next = screen.getByRole("button", { name: "Next campaign" });
    fireEvent.click(next);
    fireEvent.pointerDown(track);
    fireEvent.click(next);

    expect(scrollTo).toHaveBeenLastCalledWith({ left: 600 });
  });

  it("carries presses on past the last banner into the first", async () => {
    const { track } = await renderStrip();
    track.scrollLeft = 900;
    scrollTo.mockClear();

    const next = screen.getByRole("button", { name: "Next campaign" });
    fireEvent.click(next);
    fireEvent.click(next);

    // Headed for the copy of the first, the strip is put onto the first
    // itself at the same point, and the second press is aimed from there.
    expect(scrollTo.mock.calls).toEqual([
      [{ left: 1200 }],
      [{ behavior: "instant", left: 0 }],
      [{ left: 600 }],
    ]);
  });

  it("goes back from the first banner onto the copy of the last", async () => {
    const { track } = await renderStrip();
    track.scrollLeft = 300;
    scrollTo.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Previous campaign" }));

    expect(scrollTo).toHaveBeenCalledWith({ left: 0 });
  });

  it("reads which banner is current back off the scroll, a copy included", async () => {
    const { track } = await renderStrip();

    track.scrollLeft = 900;
    fireEvent.scroll(track);
    expect(screen.getByText("3 / 3")).toBeDefined();

    track.scrollLeft = 1200;
    fireEvent.scroll(track);
    expect(screen.getByText("1 / 3")).toBeDefined();
  });

  it("moves a strip that came to rest on a copy onto the banner it copies", async () => {
    const { track } = await renderStrip();
    track.scrollLeft = 1200;
    fireEvent.scroll(track);
    scrollTo.mockClear();

    fireEvent(track, new Event("scrollend"));

    expect(scrollTo).toHaveBeenCalledWith({ behavior: "instant", left: 300 });
  });

  it("leaves a strip that came to rest on a banner where it is", async () => {
    const { track } = await renderStrip();
    track.scrollLeft = 600;
    fireEvent.scroll(track);
    scrollTo.mockClear();

    fireEvent(track, new Event("scrollend"));

    expect(scrollTo).not.toHaveBeenCalled();
  });
});
