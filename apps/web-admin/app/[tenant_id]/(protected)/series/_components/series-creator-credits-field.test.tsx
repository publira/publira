// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import {
  cleanup,
  fireEvent,
  render as renderBase,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleProvider } from "#components/admin-locale-context";

import type { SeriesCreatorCredit } from "../series-types";
import { SeriesCreatorCreditsField } from "./series-creator-credits-field";

vi.mock("#lib/messages", () => ({
  getMessagesFor: () => Promise.resolve(bindMessages(sharedCatalog("en"))),
  loadAdminMessages: () => Promise.resolve(sharedCatalog("en")),
}));

vi.mock("#components/client-message", () => ({
  ClientMessage: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"))(message, values),
  useClientMessages: () => bindMessages(sharedCatalog("en")),
}));

// Both controls render a floating popup that jsdom cannot drive, and what is
// under test is which options this field offers and what it does with the one
// that is chosen — so each stands in as the native control with the same
// accessible name.
vi.mock("@publira/ui-components/combobox", () => ({
  Combobox: ({
    id,
    onValueChange,
    value,
  }: {
    children: ReactNode;
    id?: string;
    items: { label: string; value: string }[];
    onValueChange: (next: string) => void;
    value: string;
  }) => (
    <input
      id={id}
      onChange={(event) => onValueChange(event.target.value)}
      value={value}
    />
  ),
  ComboboxEmpty: () => null,
  ComboboxInput: () => null,
  ComboboxItems: () => null,
  ComboboxPopup: () => null,
}));

vi.mock("@publira/ui-components/select", () => ({
  Select: ({
    id,
    items,
    onValueChange,
    value,
  }: {
    id?: string;
    items: { label: ReactNode; value: string }[];
    onValueChange: (next: string) => void;
    value: string;
  }) => (
    <select
      id={id}
      onChange={(event) => onValueChange(event.target.value)}
      value={value}
    >
      {items.map((item) => (
        <option key={item.value} value={item.value}>
          {item.label}
        </option>
      ))}
    </select>
  ),
}));

const creators = [
  { name: "Original A", publicId: "CREATOR001" },
  { name: "Artist B", publicId: "CREATOR002" },
  { name: "Artist C", publicId: "CREATOR003" },
];

const creatorRoles = [
  { name: "Original Author", publicId: "ROLE001" },
  { name: "Artist", publicId: "ROLE002" },
];

const CreditsHarness = ({
  initialCredits,
}: {
  initialCredits: SeriesCreatorCredit[];
}) => {
  const [credits, setCredits] = useState(initialCredits);

  return (
    <SeriesCreatorCreditsField
      creatorRoles={creatorRoles}
      creators={creators}
      onChange={setCredits}
      value={credits}
    />
  );
};

const render = (initialCredits: SeriesCreatorCredit[]) =>
  renderBase(<CreditsHarness initialCredits={initialCredits} />, {
    wrapper: ({ children }) => (
      <AdminLocaleProvider locale="en">{children}</AdminLocaleProvider>
    ),
  });

/** What the form would post, which is the list the API stores in this order. */
const postedCredits = (): SeriesCreatorCredit[] => {
  const field = document.querySelector<HTMLInputElement>(
    'input[name="creator_credits"]'
  );
  if (!field) {
    throw new Error("the credits field is not on screen");
  }
  return JSON.parse(field.value) as SeriesCreatorCredit[];
};

/** The credited names, in the order the rows are on screen. */
const namesOnScreen = () =>
  screen
    .getAllByRole("listitem")
    .map((row) => row.querySelector("p")?.textContent);

const roleSelect = (creatorName: string) =>
  screen.getByRole<HTMLSelectElement>("combobox", {
    name: `Role of ${creatorName}`,
  });

const draftCreatorInput = () =>
  screen.getByRole<HTMLInputElement>("textbox", { name: "Author" });

const draftRoleSelect = () =>
  screen.getByRole<HTMLSelectElement>("combobox", { name: "Role" });

const optionLabels = (select: HTMLSelectElement) =>
  [...select.options].map((option) => option.textContent);

const moveDisabled = (name: string) =>
  screen.getByRole<HTMLButtonElement>("button", { name }).disabled;

afterEach(cleanup);

describe("SeriesCreatorCreditsField", () => {
  // The role's priority is what puts the leading role first, and the position
  // inside a role is what the API stores as `display_order` — so a list given
  // in any other order has to come back out in this one.
  it("shows the credits in role priority order, keeping the order inside a role", () => {
    render([
      { creatorPublicId: "CREATOR003", rolePublicId: "ROLE002" },
      { creatorPublicId: "CREATOR001", rolePublicId: "ROLE001" },
      { creatorPublicId: "CREATOR002", rolePublicId: "ROLE002" },
    ]);

    expect(namesOnScreen()).toEqual(["Original A", "Artist C", "Artist B"]);
    expect(postedCredits()).toEqual([
      { creatorPublicId: "CREATOR001", rolePublicId: "ROLE001" },
      { creatorPublicId: "CREATOR003", rolePublicId: "ROLE002" },
      { creatorPublicId: "CREATOR002", rolePublicId: "ROLE002" },
    ]);
  });

  // The select carries no visible label — the row already names the author —
  // so the only thing that names it for a screen reader is the visually hidden
  // label `Field` ties to it.
  it("names each role select after the author it credits and opens it on that role", () => {
    render([
      { creatorPublicId: "CREATOR001", rolePublicId: "ROLE001" },
      { creatorPublicId: "CREATOR002", rolePublicId: "ROLE002" },
    ]);

    expect(roleSelect("Original A").value).toBe("ROLE001");
    expect(roleSelect("Artist B").value).toBe("ROLE002");
  });

  it("credits an author in the role the picker states", () => {
    render([]);

    fireEvent.change(draftCreatorInput(), {
      target: { value: "CREATOR002" },
    });
    fireEvent.change(draftRoleSelect(), { target: { value: "ROLE002" } });
    fireEvent.click(screen.getByRole("button", { name: "Add author" }));

    expect(postedCredits()).toEqual([
      { creatorPublicId: "CREATOR002", rolePublicId: "ROLE002" },
    ]);
  });

  // The pair is the identity of a credit, so the same person can be credited
  // twice under two roles. The API refuses the same pair twice, and the role
  // that would repeat one is simply not offered.
  it("keeps offering the roles an author does not hold yet", () => {
    render([{ creatorPublicId: "CREATOR001", rolePublicId: "ROLE001" }]);

    fireEvent.change(draftCreatorInput(), {
      target: { value: "CREATOR001" },
    });

    expect(optionLabels(draftRoleSelect())).toEqual(["Artist"]);

    fireEvent.click(screen.getByRole("button", { name: "Add author" }));

    expect(postedCredits()).toEqual([
      { creatorPublicId: "CREATOR001", rolePublicId: "ROLE001" },
      { creatorPublicId: "CREATOR001", rolePublicId: "ROLE002" },
    ]);
  });

  it("closes the add button once an author holds every role", () => {
    render([
      { creatorPublicId: "CREATOR001", rolePublicId: "ROLE001" },
      { creatorPublicId: "CREATOR001", rolePublicId: "ROLE002" },
    ]);

    fireEvent.change(draftCreatorInput(), {
      target: { value: "CREATOR001" },
    });

    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Add author" })
        .disabled
    ).toBe(true);
    expect(
      screen.getByText("This author is already credited in every role.")
    ).toBeDefined();
  });

  it("moves one of two authors sharing a role past the other", () => {
    render([
      { creatorPublicId: "CREATOR001", rolePublicId: "ROLE001" },
      { creatorPublicId: "CREATOR002", rolePublicId: "ROLE002" },
      { creatorPublicId: "CREATOR003", rolePublicId: "ROLE002" },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Move Artist C up" }));

    expect(namesOnScreen()).toEqual(["Original A", "Artist C", "Artist B"]);
    expect(postedCredits()).toEqual([
      { creatorPublicId: "CREATOR001", rolePublicId: "ROLE001" },
      { creatorPublicId: "CREATOR003", rolePublicId: "ROLE002" },
      { creatorPublicId: "CREATOR002", rolePublicId: "ROLE002" },
    ]);
  });

  // The editor orders inside a role and nowhere else: the roles themselves are
  // ordered on the author roles page, so a move that would cross into another
  // role is closed rather than left to be undone by the next render.
  it("closes the moves that would leave the role", () => {
    render([
      { creatorPublicId: "CREATOR001", rolePublicId: "ROLE001" },
      { creatorPublicId: "CREATOR002", rolePublicId: "ROLE002" },
      { creatorPublicId: "CREATOR003", rolePublicId: "ROLE002" },
    ]);

    expect(moveDisabled("Move Original A up")).toBe(true);
    expect(moveDisabled("Move Original A down")).toBe(true);
    expect(moveDisabled("Move Artist B up")).toBe(true);
    expect(moveDisabled("Move Artist B down")).toBe(false);
    expect(moveDisabled("Move Artist C down")).toBe(true);
  });

  it("re-credits an author by changing the role on their row", () => {
    render([{ creatorPublicId: "CREATOR002", rolePublicId: "ROLE002" }]);

    fireEvent.change(roleSelect("Artist B"), { target: { value: "ROLE001" } });

    expect(postedCredits()).toEqual([
      { creatorPublicId: "CREATOR002", rolePublicId: "ROLE001" },
    ]);
  });

  it("drops the credit the remove button sits on", () => {
    render([
      { creatorPublicId: "CREATOR001", rolePublicId: "ROLE001" },
      { creatorPublicId: "CREATOR002", rolePublicId: "ROLE002" },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Remove Artist B" }));

    expect(postedCredits()).toEqual([
      { creatorPublicId: "CREATOR001", rolePublicId: "ROLE001" },
    ]);
  });

  // Editing this list is editing the template the next episode is baked from,
  // so the form says as much rather than leaving an editor to assume a save
  // re-credits the episodes that already shipped.
  it("says that the credits reach episodes created from now on", () => {
    render([]);

    expect(
      screen.getByText(/template new episodes are created from/u)
    ).toBeDefined();
  });
});
