// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";

import { EpisodeCampaignPricesDialog } from "./episode-campaign-prices-dialog";
import { EpisodeSelectionProvider } from "./episode-selection";

vi.mock("#lib/use-tenant-id", () => ({
  useTenantId: () => "TENANT001",
}));

vi.mock("@publira/ui-components/toast", () => ({
  useManager: () => ({ add: vi.fn() }),
}));

const openDialog = (selectedIds: readonly string[]) => {
  render(
    <AdminLocaleTestProvider locale="en">
      <EpisodeSelectionProvider initialSelectedIds={selectedIds}>
        <EpisodeCampaignPricesDialog
          action={vi.fn()}
          currency="JPY"
          seriesId="SERIES001-ID"
          timeZone="UTC"
        />
      </EpisodeSelectionProvider>
    </AdminLocaleTestProvider>
  );
  fireEvent.click(screen.getByRole("button", { name: "Campaign price" }));
};

const hiddenValue = (name: string): string | undefined =>
  document.querySelector<HTMLInputElement>(
    `input[type="hidden"][name="${name}"]`
  )?.value;

describe("EpisodeCampaignPricesDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("posts the checked episodes with the price in the tenant's currency", () => {
    openDialog(["EP1-ID", "EP2-ID"]);

    expect(screen.getByText("2 episodes selected on the list.")).toBeDefined();
    expect(JSON.parse(hiddenValue("episode_ids") ?? "")).toEqual([
      "EP1-ID",
      "EP2-ID",
    ]);
    expect(hiddenValue("price_currency")).toBe("JPY");
    expect(
      screen.getByRole("spinbutton", { name: /Campaign price/u })
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Add" }).hasAttribute("disabled")
    ).toBe(false);
  });

  it("asks for checks first and offers no submit while none is made", () => {
    openDialog([]);

    expect(
      screen.getByText("Check the episodes to put on sale on the list first.")
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Add" }).hasAttribute("disabled")
    ).toBe(true);
  });
});
