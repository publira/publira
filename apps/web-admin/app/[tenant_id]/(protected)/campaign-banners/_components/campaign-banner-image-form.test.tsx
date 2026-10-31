// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import type * as ActionForm from "@publira/ui-components/action-form";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";

import type { CampaignBannerListItem } from "../campaign-banner-types";
import { CampaignBannerImageForm } from "./campaign-banner-image-form";

const { mockUpdateCampaignBannerImageAction } = vi.hoisted(() => ({
  mockUpdateCampaignBannerImageAction: vi.fn(),
}));

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
}));

vi.mock("../_lib/actions", () => ({
  updateCampaignBannerImageAction: mockUpdateCampaignBannerImageAction,
}));

// The image field is a client control, which reads its own copy from the
// catalog the console layout provides.
const EnglishConsole = ({ children }: { children: ReactNode }) => (
  <AdminLocaleTestProvider locale="en">{children}</AdminLocaleTestProvider>
);

const banner: CampaignBannerListItem = {
  altText: "Summer sale, up to 50% off",
  endsAt: "2000-01-02T00:00:00Z",
  id: "018f0e6a-6000-7000-8000-000000000001",
  imageUpdatedAt: "2099-05-01T00:00:00Z",
  imageVariants: [
    {
      contentType: "image/webp",
      fileSizeBytes: 2048,
      height: 900,
      label: "landscape_1600w",
      url: "https://cdn.example.com/campaign-banners/BANNER001/landscape.webp",
      variantType: "landscape",
      width: 1600,
    },
  ],
  linkUrl: "/series/SERIES001",
  publicId: "BANNER001",
  published: false,
  startsAt: "2000-01-01T00:00:00Z",
};

afterEach(() => {
  cleanup();
});

describe("CampaignBannerImageForm", () => {
  // The API has no way to clear a banner's image, so the shared field must not
  // offer to.
  it("offers to replace the image and never to delete it", async () => {
    await act(() => {
      render(<CampaignBannerImageForm banner={banner} tenantId="TENANT001" />, {
        wrapper: EnglishConsole,
      });
    });

    expect(screen.getByLabelText("Cover image")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Delete the current cover image" })
    ).toBeNull();
  });

  it("posts back the link, the alternative text, the window, and the flag the banner holds", async () => {
    // Never resolved: the assertions are about what the save was sent with.
    const save = Promise.withResolvers<ActionForm.State>();
    mockUpdateCampaignBannerImageAction.mockReturnValue(save.promise);

    await act(() => {
      render(<CampaignBannerImageForm banner={banner} tenantId="TENANT001" />, {
        wrapper: EnglishConsole,
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "Update image" }));

    await waitFor(() => {
      expect(mockUpdateCampaignBannerImageAction).toHaveBeenCalledOnce();
    });

    const [, formData] = mockUpdateCampaignBannerImageAction.mock
      .calls[0] as unknown as [ActionForm.State, FormData];

    expect(formData.get("campaign_banner_id")).toBe(banner.id);
    expect(formData.get("link_url")).toBe("/series/SERIES001");
    // The API replaces it with the image, so leaving it out would clear it.
    expect(formData.get("alt_text")).toBe("Summer sale, up to 50% off");
    // A window already over goes back unchanged, which the API accepts.
    expect(formData.get("starts_at")).toBe("2000-01-01T00:00:00Z");
    expect(formData.get("ends_at")).toBe("2000-01-02T00:00:00Z");
    expect(formData.has("published")).toBe(false);
    expect(formData.has("clear_eye_catch_image")).toBe(false);
    expect(formData.get("current_eye_catch_image_updated_at")).toBe(
      "2099-05-01T00:00:00Z"
    );
  });
});
