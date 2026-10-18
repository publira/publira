// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CampaignBannerItem } from "#lib/campaign-banners";

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

beforeEach(() => {
  mockListCampaignBanners.mockReset();
});

const banner = (
  publicId: string,
  linkUrl = `/series/${publicId}`
): CampaignBannerItem => ({
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
  return element ? render(element) : null;
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

/** jsdom lays nothing out, so the strip is given one slide per view. */
const layOut = (track: HTMLElement, slideWidth: number) => {
  Object.defineProperty(track, "clientWidth", { value: slideWidth });
  for (const [index, slide] of [...track.children].entries()) {
    Object.defineProperty(slide, "offsetLeft", {
      value: index * slideWidth,
    });
    Object.defineProperty(slide, "offsetWidth", { value: slideWidth });
  }
};

const renderStrip = async () => {
  await renderSection([
    banner("BANNER01"),
    banner("BANNER02"),
    banner("BANNER03"),
  ]);
  const track = screen.getByRole("list");
  layOut(track, 300);
  const scrollTo = vi.fn();
  track.scrollTo = scrollTo;
  return { scrollTo, track };
};

describe("CampaignBannerCarousel", () => {
  it("opens on the first banner, with nothing before it to go back to", async () => {
    await renderStrip();

    expect(screen.getByText("1 / 3")).toBeDefined();
    expect(
      screen
        .getByRole("button", { name: "Previous campaign" })
        .hasAttribute("disabled")
    ).toBe(true);
  });

  it("scrolls the strip to the next banner rather than keeping a position of its own", async () => {
    const { scrollTo } = await renderStrip();

    fireEvent.click(screen.getByRole("button", { name: "Next campaign" }));

    expect(scrollTo).toHaveBeenCalledWith({ left: 300 });
    // The counter follows the scroll, not the press.
    expect(screen.getByText("1 / 3")).toBeDefined();
  });

  it("reads which banner is current back off the scroll", async () => {
    const { track } = await renderStrip();

    track.scrollLeft = 600;
    fireEvent.scroll(track);

    expect(screen.getByText("3 / 3")).toBeDefined();
    expect(
      screen
        .getByRole("button", { name: "Next campaign" })
        .hasAttribute("disabled")
    ).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "Previous campaign" })
        .hasAttribute("disabled")
    ).toBe(false);
  });
});
