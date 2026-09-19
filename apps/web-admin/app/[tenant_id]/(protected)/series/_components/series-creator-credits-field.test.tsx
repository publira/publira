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

// The real combobox drops a floating popup jsdom cannot drive, and what is
// under test is which options this field offers and what it does with the one
// that is chosen — so it stands in as a native control keeping the accessible
// name its label gives it. The blank entry is what "nothing picked yet" is.
vi.mock("@publira/ui-components/combobox", () => ({
  Combobox: ({
    id,
    items,
    onValueChange,
    value,
  }: {
    children: ReactNode;
    id?: string;
    items: { label: string; value: string }[];
    onValueChange: (next: string) => void;
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

// dnd-kit measures the elements it sorts, which jsdom cannot do. Dragging is
// covered by the e2e suite; here the provider and the handle only have to
// render, so the list around them can be asserted on.
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

const creators = [
  { name: "Original A", publicId: "CREATOR001" },
  { name: "Artist B", publicId: "CREATOR002" },
  { name: "Artist C", publicId: "CREATOR003" },
];

const creatorRoles = [
  { name: "Original Author", publicId: "ROLE001" },
  { name: "Artist", publicId: "ROLE002" },
];

const render = (
  initialCredits: SeriesCreatorCredit[],
  onSavableChange: (savable: boolean) => void = vi.fn()
) =>
  renderBase(
    <SeriesCreatorCreditsField
      creatorRoles={creatorRoles}
      creators={creators}
      initialCredits={initialCredits}
      onSavableChange={onSavableChange}
    />,
    {
      wrapper: ({ children }) => (
        <AdminLocaleProvider locale="en" messages={sharedCatalog("en")}>
          {children}
        </AdminLocaleProvider>
      ),
    }
  );

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

const creatorPicker = (position: number) =>
  screen.getByRole<HTMLSelectElement>("combobox", {
    name: `Author ${position}`,
  });

const rolePicker = (position: number) =>
  screen.getByRole<HTMLSelectElement>("combobox", { name: `Role ${position}` });

const shareInput = (position: number) =>
  screen.getByRole<HTMLInputElement>("textbox", {
    name: `Share of author ${position}`,
  });

/** The authors, in the order the rows are on screen. */
const namesOnScreen = () =>
  screen
    .getAllByRole<HTMLSelectElement>("combobox", { name: /^Author \d+$/u })
    .map((control) => control.selectedOptions[0]?.textContent);

/** The roles on offer; the mock's blank entry is not one of them. */
const optionLabels = (control: HTMLSelectElement) =>
  [...control.options]
    .filter((option) => option.value !== "")
    .map((option) => option.textContent);

afterEach(cleanup);

describe("SeriesCreatorCreditsField", () => {
  // The API reads the credits back grouped by role priority and orders a save
  // the same way, so nothing here re-sorts them — a row that sorted itself the
  // moment its author was chosen would move out from under the editor.
  it("keeps the order it was given and posts it unchanged", () => {
    const credits = [
      { creatorPublicId: "CREATOR001", rolePublicId: "ROLE001", shareBps: 0 },
      { creatorPublicId: "CREATOR003", rolePublicId: "ROLE002", shareBps: 0 },
      { creatorPublicId: "CREATOR002", rolePublicId: "ROLE002", shareBps: 0 },
    ];

    render(credits);

    expect(namesOnScreen()).toEqual(["Original A", "Artist C", "Artist B"]);
    expect(postedCredits()).toEqual(credits);
  });

  // The row an editor is filling in stays where the Add button put it, which
  // is the end of the list, whatever role it ends up stating.
  it("leaves a new row at the end while it is being filled in", () => {
    render([
      { creatorPublicId: "CREATOR002", rolePublicId: "ROLE002", shareBps: 0 },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Add author" }));
    fireEvent.change(creatorPicker(2), { target: { value: "CREATOR001" } });

    expect(namesOnScreen()).toEqual(["Artist B", "Original A"]);
    expect(postedCredits()).toEqual([
      { creatorPublicId: "CREATOR002", rolePublicId: "ROLE002", shareBps: 0 },
      { creatorPublicId: "CREATOR001", rolePublicId: "ROLE001", shareBps: 0 },
    ]);
  });

  // Neither picker carries a visible label — the value in the box is the
  // answer — so the only thing that names them for a screen reader is the
  // visually hidden label `Field` ties to each one.
  it("names both pickers on a row after the position it sits at", () => {
    render([
      { creatorPublicId: "CREATOR001", rolePublicId: "ROLE001", shareBps: 0 },
      { creatorPublicId: "CREATOR002", rolePublicId: "ROLE002", shareBps: 0 },
    ]);

    expect(creatorPicker(1).value).toBe("CREATOR001");
    expect(rolePicker(1).value).toBe("ROLE001");
    expect(creatorPicker(2).value).toBe("CREATOR002");
    expect(rolePicker(2).value).toBe("ROLE002");
  });

  // Correcting a credit is changing the row, not deleting it and writing it
  // again — the author is a picker for as long as the row exists.
  it("re-credits a row by changing the author on it", () => {
    render([
      { creatorPublicId: "CREATOR002", rolePublicId: "ROLE002", shareBps: 0 },
    ]);

    fireEvent.change(creatorPicker(1), { target: { value: "CREATOR003" } });

    expect(postedCredits()).toEqual([
      { creatorPublicId: "CREATOR003", rolePublicId: "ROLE002", shareBps: 0 },
    ]);
  });

  it("re-credits a row by changing the role on it", () => {
    render([
      { creatorPublicId: "CREATOR002", rolePublicId: "ROLE002", shareBps: 0 },
    ]);

    fireEvent.change(rolePicker(1), { target: { value: "ROLE001" } });

    expect(postedCredits()).toEqual([
      { creatorPublicId: "CREATOR002", rolePublicId: "ROLE001", shareBps: 0 },
    ]);
  });

  // A row exists before it says anything, so the form has to stay savable
  // while one is still being filled in.
  it("opens an empty row and posts it only once it names a credit", () => {
    render([]);

    fireEvent.click(screen.getByRole("button", { name: "Add author" }));

    expect(creatorPicker(1).value).toBe("");
    expect(postedCredits()).toEqual([]);

    fireEvent.change(creatorPicker(1), { target: { value: "CREATOR002" } });

    expect(postedCredits()).toEqual([
      { creatorPublicId: "CREATOR002", rolePublicId: "ROLE001", shareBps: 0 },
    ]);
  });

  // The pair is the identity of a credit, so the same person can be credited
  // twice under two roles. The API refuses the same pair twice, and the role
  // that would repeat one is simply not offered.
  it("keeps offering the roles an author does not hold yet", () => {
    render([
      { creatorPublicId: "CREATOR001", rolePublicId: "ROLE001", shareBps: 0 },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Add author" }));
    fireEvent.change(creatorPicker(2), { target: { value: "CREATOR001" } });

    expect(optionLabels(rolePicker(2))).toEqual(["Artist"]);
    expect(postedCredits()).toEqual([
      { creatorPublicId: "CREATOR001", rolePublicId: "ROLE001", shareBps: 0 },
      { creatorPublicId: "CREATOR001", rolePublicId: "ROLE002", shareBps: 0 },
    ]);
  });

  it("says so when an author holds every role already", () => {
    render([
      { creatorPublicId: "CREATOR001", rolePublicId: "ROLE001", shareBps: 0 },
      { creatorPublicId: "CREATOR001", rolePublicId: "ROLE002", shareBps: 0 },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Add author" }));
    fireEvent.change(creatorPicker(3), { target: { value: "CREATOR001" } });

    expect(
      screen.getByText("This author is already credited in every role.")
    ).toBeDefined();
    // Nothing left to credit them in, so the row states no credit yet.
    expect(postedCredits()).toHaveLength(2);
  });

  // Only the handle drags, so the pickers inside the row still take a pointer.
  // The drag itself is an e2e concern; what belongs here is that every row
  // offers the handle at all.
  it("gives every row a drag handle", () => {
    render([
      { creatorPublicId: "CREATOR001", rolePublicId: "ROLE001", shareBps: 0 },
      { creatorPublicId: "CREATOR002", rolePublicId: "ROLE002", shareBps: 0 },
    ]);

    expect(
      screen.getByRole("button", { name: "Reorder author 1" })
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Reorder author 2" })
    ).toBeDefined();
  });

  it("drops the credit the remove button sits on", () => {
    render([
      { creatorPublicId: "CREATOR001", rolePublicId: "ROLE001", shareBps: 0 },
      { creatorPublicId: "CREATOR002", rolePublicId: "ROLE002", shareBps: 0 },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Remove author 2" }));

    expect(postedCredits()).toEqual([
      { creatorPublicId: "CREATOR001", rolePublicId: "ROLE001", shareBps: 0 },
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

  it("opens a stored share as the percentage it stands for", () => {
    render([
      {
        creatorPublicId: "CREATOR001",
        rolePublicId: "ROLE001",
        shareBps: 3333,
      },
      { creatorPublicId: "CREATOR002", rolePublicId: "ROLE002", shareBps: 0 },
    ]);

    expect(shareInput(1).value).toBe("33.33");
    expect(shareInput(2).value).toBe("0");
  });

  it("shows the publisher's remainder and posts the shares in basis points", () => {
    const onSavableChange = vi.fn();
    render(
      [
        { creatorPublicId: "CREATOR001", rolePublicId: "ROLE001", shareBps: 0 },
        { creatorPublicId: "CREATOR002", rolePublicId: "ROLE002", shareBps: 0 },
      ],
      onSavableChange
    );

    fireEvent.change(shareInput(1), { target: { value: "30" } });
    fireEvent.change(shareInput(2), { target: { value: "20" } });

    expect(screen.getByText("Authors 50% · Publisher 50%")).toBeDefined();
    expect(postedCredits().map((credit) => credit.shareBps)).toEqual([
      3000, 2000,
    ]);
    expect(onSavableChange).toHaveBeenLastCalledWith(true);
  });

  // A float product would post 3332.9999999999995 or 3333.3; the API takes an
  // integer.
  it("converts two decimal places to a whole number of basis points", () => {
    render([
      { creatorPublicId: "CREATOR001", rolePublicId: "ROLE001", shareBps: 0 },
    ]);

    fireEvent.change(shareInput(1), { target: { value: "33.33" } });

    expect(postedCredits()).toEqual([
      {
        creatorPublicId: "CREATOR001",
        rolePublicId: "ROLE001",
        shareBps: 3333,
      },
    ]);
  });

  it("names the excess and blocks the save when the shares pass 100%", () => {
    const onSavableChange = vi.fn();
    render(
      [
        { creatorPublicId: "CREATOR001", rolePublicId: "ROLE001", shareBps: 0 },
        { creatorPublicId: "CREATOR002", rolePublicId: "ROLE002", shareBps: 0 },
      ],
      onSavableChange
    );

    fireEvent.change(shareInput(1), { target: { value: "60" } });
    fireEvent.change(shareInput(2), { target: { value: "50" } });

    expect(
      screen.getByText(
        "The shares add up to 110%, 10% over 100%. Lower them to save."
      )
    ).toBeDefined();
    expect(onSavableChange).toHaveBeenLastCalledWith(false);

    // Removing a row is the other edit that moves the sum.
    fireEvent.click(screen.getByRole("button", { name: "Remove author 1" }));

    expect(onSavableChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByText("Authors 50% · Publisher 50%")).toBeDefined();
  });

  it("blocks the save while a share box holds something that is not a share", () => {
    const onSavableChange = vi.fn();
    render(
      [{ creatorPublicId: "CREATOR001", rolePublicId: "ROLE001", shareBps: 0 }],
      onSavableChange
    );

    fireEvent.change(shareInput(1), { target: { value: "12.345" } });

    expect(shareInput(1).getAttribute("aria-invalid")).toBe("true");
    expect(
      screen.getByText(
        "Enter each share as a percentage from 0 to 100, with up to two decimal places."
      )
    ).toBeDefined();
    expect(onSavableChange).toHaveBeenLastCalledWith(false);
  });
});
