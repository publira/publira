// @vitest-environment jsdom

import { CreatorCreditSource } from "@publira/api-client/admin/types";
import { bindMessages } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleProvider } from "#components/admin-locale-context";

import { EpisodeCreatorCreditsForm } from "./episode-creator-credits-form";

const messages = bindMessages(sharedCatalog("en"));
vi.mock("#components/client-message", () => ({
  ClientMessage: ({
    message,
    values,
  }: {
    message: Parameters<typeof messages>[0];
    values?: Parameters<typeof messages>[1];
  }) => messages(message, values),
}));
vi.mock("#lib/use-tenant-id", () => ({ useTenantId: () => "TENANT001" }));
vi.mock("@publira/ui-components/combobox", () => ({
  Combobox: ({
    id,
    items,
    onValueChange,
    value,
  }: {
    id?: string;
    items: { label: string; value: string }[];
    onValueChange: (value: string) => void;
    value: string;
  }) => (
    <select
      id={id}
      onChange={(event) => onValueChange(event.target.value)}
      value={value}
    >
      <option value="">-</option>
      {items.map((item) => (
        <option key={item.value} value={item.value}>
          {item.label}
        </option>
      ))}
    </select>
  ),
  ComboboxEmpty: () => null,
  ComboboxInput: () => null,
  ComboboxItems: () => null,
  ComboboxPopup: () => null,
}));

const renderForm = () =>
  render(
    <EpisodeCreatorCreditsForm
      action={() => Promise.resolve(null)}
      creatorRoles={[{ name: "Artist", publicId: "ROLE001" }]}
      creators={[{ name: "Guest", publicId: "CREATOR001" }]}
      episodePublicId="EP001"
      initialCredits={[
        {
          creatorPublicId: "CREATOR001",
          rolePublicId: "ROLE001",
          source: CreatorCreditSource.EPISODE,
        },
      ]}
      seriesPublicId="SERIES001"
    />,
    {
      wrapper: ({ children }) => (
        <AdminLocaleProvider locale="en">{children}</AdminLocaleProvider>
      ),
    }
  );
const postedCredits = () =>
  JSON.parse(
    document.querySelector<HTMLInputElement>('input[name="creator_credits"]')
      ?.value ?? "[]"
  ) as { creatorPublicId: string; rolePublicId: string }[];

afterEach(cleanup);

describe("EpisodeCreatorCreditsForm", () => {
  it("marks credits added on this episode", () => {
    renderForm();
    expect(screen.getByText("Episode only")).toBeDefined();
    expect(
      document.querySelector<HTMLInputElement>('input[name="series_public_id"]')
        ?.value
    ).toBe("SERIES001");
  });
  it("adds a row without adding an incomplete credit to the replacement list", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Add author" }));
    expect(postedCredits()).toHaveLength(1);
  });
  it("removes a credit from the replacement list", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Remove author 1" }));
    expect(postedCredits()).toEqual([]);
  });
});
