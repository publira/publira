// @vitest-environment jsdom

import { CreatorCreditSource } from "@publira/api-client/admin/types";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";

import type {
  EpisodeCreatorCredit,
  EpisodeEditActionState,
} from "../episode-edit-types";
import { EpisodeCreatorCreditsForm } from "./episode-creator-credits-form";

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

const guestCredit: EpisodeCreatorCredit = {
  creatorPublicId: "CREATOR001",
  rolePublicId: "ROLE001",
  shareBps: 0,
  source: CreatorCreditSource.EPISODE,
};

const teamCredits: EpisodeCreatorCredit[] = [
  {
    creatorPublicId: "CREATOR001",
    rolePublicId: "ROLE001",
    shareBps: 0,
    source: CreatorCreditSource.SERIES,
  },
  {
    creatorPublicId: "CREATOR002",
    rolePublicId: "ROLE001",
    shareBps: 0,
    source: CreatorCreditSource.SERIES,
  },
];

const renderForm = (
  initialCredits: EpisodeCreatorCredit[] = [guestCredit],
  action: () => Promise<EpisodeEditActionState> = () => Promise.resolve(null)
) =>
  render(
    <EpisodeCreatorCreditsForm
      action={action}
      creatorRoles={[{ name: "Artist", publicId: "ROLE001" }]}
      creators={[
        { name: "Guest", publicId: "CREATOR001" },
        { name: "Colorist", publicId: "CREATOR002" },
      ]}
      episodePublicId="EP001"
      initialCredits={initialCredits}
      seriesPublicId="SERIES001"
    />,
    {
      wrapper: ({ children }) => (
        <AdminLocaleTestProvider locale="en">
          {children}
        </AdminLocaleTestProvider>
      ),
    }
  );
const postedCredits = () =>
  JSON.parse(
    document.querySelector<HTMLInputElement>('input[name="creator_credits"]')
      ?.value ?? "[]"
  ) as { creatorPublicId: string; rolePublicId: string; shareBps: number }[];

const typeShare = (position: number, value: string) => {
  fireEvent.change(
    screen.getByRole("textbox", { name: `Share of author ${position}` }),
    { target: { value } }
  );
};

const saveButton = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: "Save authors" });

afterEach(cleanup);

// A control its `<fieldset>` closes keeps `disabled` false and matches
// `:disabled` instead.
const submittedControls = () => [
  ...screen.getAllByRole("combobox"),
  screen.getByRole("textbox", { name: "Share of author 1" }),
  screen.getByRole("button", { name: "Remove author 1" }),
  screen.getByRole("button", { name: "Add author" }),
];

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
  it("shows the publisher's remainder and saves the shares in basis points", () => {
    renderForm(teamCredits);
    typeShare(1, "30");
    typeShare(2, "20");
    expect(screen.getByText("Authors 50% · Publisher 50%")).toBeDefined();
    expect(postedCredits().map((credit) => credit.shareBps)).toEqual([
      3000, 2000,
    ]);
    expect(saveButton().disabled).toBe(false);
  });
  it("blocks the save and names the sum when the shares pass 100%", () => {
    renderForm(teamCredits);
    typeShare(1, "60");
    typeShare(2, "50");
    expect(
      screen.getByText(
        "The shares add up to 110%, 10% over 100%. Lower them to save."
      )
    ).toBeDefined();
    expect(saveButton().disabled).toBe(true);
  });
  it("opens a stored share as a percentage and keeps it when untouched", () => {
    renderForm([{ ...guestCredit, shareBps: 3333 }]);
    expect(
      screen.getByRole<HTMLInputElement>("textbox", {
        name: "Share of author 1",
      }).value
    ).toBe("33.33");
    expect(postedCredits()[0]?.shareBps).toBe(3333);
  });
  // The Action carries the credits the form held when it was submitted, so a
  // change made while it is in flight would sit in the list unsaved.
  it("closes the credits while the save is in flight", async () => {
    // Never resolved: the assertions are about the window the save is open in.
    const save = Promise.withResolvers<EpisodeEditActionState>();
    renderForm([guestCredit], () => save.promise);

    for (const control of submittedControls()) {
      expect(control.matches(":disabled")).toBe(false);
    }

    fireEvent.click(saveButton());

    await waitFor(() => {
      for (const control of submittedControls()) {
        expect(control.matches(":disabled")).toBe(true);
      }
    });
  });
});
