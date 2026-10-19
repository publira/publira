// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";
import { renderServerComponent } from "#lib/render-server-component";

import type { CampaignBannerListItem } from "../campaign-banner-types";
import { CampaignBannerList } from "./campaign-banner-list";

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
}));

// A thumbnail's `alt` is resolved from the request's catalog.
vi.mock("#lib/get-messages", () => ({
  getMessages: () => Promise.resolve(bindMessages(sharedCatalog("en"), "en")),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: ComponentProps<"a">) => (
    <a href={href}>{children}</a>
  ),
}));

// The Actions are `"use server"`, so the module they live in cannot be
// evaluated here at all.
vi.mock("../_lib/actions", () => ({
  deleteCampaignBannerAction: vi.fn(),
  reorderCampaignBannersAction: vi.fn(),
}));

vi.mock("@dnd-kit/react", () => ({
  DragDropProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@dnd-kit/react/sortable", () => ({
  useSortable: () => ({
    handleRef: vi.fn(),
    isDragging: false,
    ref: vi.fn(),
  }),
}));

const banners: CampaignBannerListItem[] = [
  {
    altText: "",
    endsAt: "2099-07-01T00:00:00Z",
    id: "018f0e6a-6000-7000-8000-000000000001",
    imageUpdatedAt: "",
    imageVariants: [],
    linkUrl: "/series/SERIES001",
    publicId: "BANNER001",
    published: true,
    startsAt: "2099-06-01T00:00:00Z",
  },
  {
    altText: "Summer sale, up to 50% off",
    endsAt: "2099-07-01T00:00:00Z",
    id: "018f0e6a-6000-7000-8000-000000000002",
    imageUpdatedAt: "2099-05-01T00:00:00Z",
    imageVariants: [
      {
        contentType: "image/webp",
        fileSizeBytes: 2048,
        height: 900,
        label: "landscape_1600w",
        url: "https://cdn.example.com/campaign-banners/BANNER002/landscape.webp",
        variantType: "landscape",
        width: 1600,
      },
    ],
    linkUrl: "https://example.com/sale",
    publicId: "BANNER002",
    published: false,
    startsAt: "2099-06-01T00:00:00Z",
  },
];

const renderList = (canEdit: boolean) =>
  render(
    <AdminLocaleTestProvider locale="en">
      <CampaignBannerList
        banners={banners}
        canEdit={canEdit}
        locale="en"
        now={Temporal.Instant.from("2099-06-15T00:00:00Z")}
        tenantId="TENANT001"
        timeZone="Asia/Tokyo"
      />
    </AdminLocaleTestProvider>
  );

afterEach(() => {
  cleanup();
});

describe("CampaignBannerList", () => {
  it("offers an editor to reorder, edit, and delete each banner", () => {
    renderList(true);

    expect(
      screen.getByRole("button", {
        name: "Reorder the banner linking to /series/SERIES001",
      })
    ).toBeTruthy();
    expect(
      screen
        .getAllByRole("link", { name: "Edit" })
        .map((link) => link.getAttribute("href"))
    ).toEqual(["/campaign-banners/BANNER001", "/campaign-banners/BANNER002"]);
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(2);
  });

  // A banner the operator described is named by the words in its image, and
  // one nobody has described by where it links.
  it("names each banner by its alternative text, or by its link without one", () => {
    renderList(true);

    expect(
      screen.getByRole("button", {
        name: "Reorder the banner “Summer sale, up to 50% off”",
      })
    ).toBeTruthy();
    expect(screen.getByText("Summer sale, up to 50% off")).toBeTruthy();
    // The link stays on the row under the name.
    expect(screen.getByText("https://example.com/sale")).toBeTruthy();
  });

  // The thumbnail resolves its `alt` from the catalog on the server.
  it("gives a described banner's thumbnail the words in its image", async () => {
    await renderServerComponent(
      <AdminLocaleTestProvider locale="en">
        <CampaignBannerList
          banners={banners}
          canEdit={false}
          locale="en"
          now={Temporal.Instant.from("2099-06-15T00:00:00Z")}
          tenantId="TENANT001"
          timeZone="Asia/Tokyo"
        />
      </AdminLocaleTestProvider>
    );

    expect(screen.getByRole("img").getAttribute("alt")).toBe(
      "Summer sale, up to 50% off"
    );
  });

  it("shows each window in the tenant's time zone, and whether it is on air", () => {
    renderList(true);

    expect(
      screen.getAllByText(
        "Jun 1, 2099, 9:00 AM to Jul 1, 2099, 9:00 AM (Asia/Tokyo)"
      )
    ).toHaveLength(2);
    expect(screen.getByText("Showing")).toBeTruthy();
    // Inside its window, but kept off the site.
    expect(screen.getByText("Unpublished")).toBeTruthy();
  });

  it("offers an auditor only to view each banner", () => {
    renderList(false);

    expect(screen.getByText("/series/SERIES001")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(
      screen
        .getAllByRole("link", { name: "View" })
        .map((link) => link.getAttribute("href"))
    ).toEqual(["/campaign-banners/BANNER001", "/campaign-banners/BANNER002"]);
  });
});
