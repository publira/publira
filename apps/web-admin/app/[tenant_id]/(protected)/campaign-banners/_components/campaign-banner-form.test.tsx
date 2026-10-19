// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import type { FormActionState } from "@publira/ui-components/action-form";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CampaignBannerListItem } from "../campaign-banner-types";
import { CampaignBannerForm } from "./campaign-banner-form";

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
}));

vi.mock("#lib/get-messages", () => ({
  getMessages: () => Promise.resolve(bindMessages(sharedCatalog("en"), "en")),
}));

const action = (): Promise<FormActionState> => Promise.resolve(null);

const banner: CampaignBannerListItem = {
  altText: "Summer sale, up to 50% off",
  endsAt: "2099-07-01T00:00:00Z",
  id: "018f0e6a-6000-7000-8000-000000000001",
  imageUpdatedAt: "2099-05-01T00:00:00Z",
  imageVariants: [],
  linkUrl: "/series/SERIES001",
  publicId: "BANNER001",
  published: true,
  startsAt: "2099-06-01T00:00:00Z",
};

afterEach(() => {
  cleanup();
});

describe("CampaignBannerForm", () => {
  // A banner with neither is a band that shows nothing, so the browser asks
  // for both before the form is sent at all.
  it("asks a new banner for both an image and a link", async () => {
    render(
      await CampaignBannerForm({
        action,
        tenantId: "TENANT001",
        timeZone: "Asia/Tokyo",
      })
    );

    expect(
      screen.getByLabelText<HTMLInputElement>(/Banner image/u).required
    ).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>(/Link/u).required).toBe(
      true
    );
    // A banner nobody has described still saves; the site names it itself.
    expect(
      screen.getByLabelText<HTMLInputElement>("Alternative text").required
    ).toBe(false);
  });

  it("enters the window in the tenant's time zone", async () => {
    render(
      await CampaignBannerForm({
        action,
        initialBanner: banner,
        tenantId: "TENANT001",
        timeZone: "Asia/Tokyo",
      })
    );

    expect(screen.getByLabelText<HTMLInputElement>(/Shows from/u).value).toBe(
      "2099-06-01T09:00"
    );
    expect(screen.getByLabelText<HTMLInputElement>(/Shows until/u).value).toBe(
      "2099-07-01T09:00"
    );
    expect(
      screen.getByText(/Entered in the site's time zone \(Asia\/Tokyo\)/u)
    ).toBeTruthy();
  });

  it("opens an existing banner on what it holds and leaves its image to the image tab", async () => {
    render(
      await CampaignBannerForm({
        action,
        initialBanner: banner,
        tenantId: "TENANT001",
        timeZone: "Asia/Tokyo",
      })
    );

    expect(screen.queryByLabelText(/Banner image/u)).toBeNull();
    expect(
      screen.getByLabelText<HTMLInputElement>("Alternative text").value
    ).toBe("Summer sale, up to 50% off");
    expect(screen.getByLabelText<HTMLInputElement>(/Link/u).value).toBe(
      "/series/SERIES001"
    );
    expect(
      screen.getByRole("checkbox", { name: "Published" }).ariaChecked
    ).toBe("true");
    expect(screen.getByRole("button", { name: "Update banner" })).toBeTruthy();
  });
});
