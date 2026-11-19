// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CampaignBannerDeleteButton } from "./campaign-banner-delete-button";

// The Action is `"use server"`, so the module it lives in cannot be evaluated
// here at all.
vi.mock("../_lib/actions", () => ({
  deleteCampaignBannerAction: vi.fn(),
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

/** Both the trigger and the confirmation read "Delete", so the dialog scopes. */
const openConfirmation = async (altText: string) => {
  await act(() => {
    render(
      <CampaignBannerDeleteButton
        altText={altText}
        id="018f0e6a-6000-7000-8000-000000000001"
        linkUrl="https://example.com/sale"
        tenantId="TENANT001"
      />
    );
  });
  fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

  return within(await screen.findByRole("alertdialog"));
};

afterEach(() => {
  cleanup();
});

describe("CampaignBannerDeleteButton", () => {
  it("names the banner by the words in its image", async () => {
    const dialog = await openConfirmation("Summer sale, up to 50% off");

    expect(
      dialog.getByText(
        "The banner “Summer sale, up to 50% off” and its image are removed, and the site stops showing it at once."
      )
    ).toBeDefined();
  });

  it("names a banner nobody has described by where it links", async () => {
    const dialog = await openConfirmation("");

    expect(
      dialog.getByText(
        "The banner linking to https://example.com/sale and its image are removed, and the site stops showing it at once."
      )
    ).toBeDefined();
  });
});
