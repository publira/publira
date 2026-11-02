// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import * as ActionForm from "@publira/ui-components/action-form";
import {
  cleanup,
  fireEvent,
  render as renderBase,
  screen,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";

import { VolumeBookstoreLinksEditor } from "./volume-bookstore-links-editor";

vi.mock("#components/client-message", () => ({
  ClientMessage: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
  useClientMessages: () => bindMessages(sharedCatalog("en"), "en"),
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

const links = [
  { label: "Bookstore A", url: "https://books.example.com/volume-1" },
  { label: "Bookstore B", url: "https://shop.example.net/v1" },
];

const render = (
  initialLinks: { label: string; url: string }[],
  action: ActionForm.RootProps["action"] = vi.fn(() => Promise.resolve(null))
) =>
  renderBase(
    <ActionForm.Root action={action}>
      <VolumeBookstoreLinksEditor initialLinks={initialLinks} />
      <button type="submit">Save</button>
    </ActionForm.Root>,
    {
      wrapper: ({ children }) => (
        <AdminLocaleTestProvider locale="en">
          {children}
        </AdminLocaleTestProvider>
      ),
    }
  );

/** What the form would post, which is the list the API stores in this order. */
const postedLinks = (): { label: string; url: string }[] => {
  const field = document.querySelector<HTMLInputElement>(
    'input[name="bookstore_links"]'
  );

  if (!field) {
    throw new Error("the bookstore link field is not on screen");
  }

  // SAFETY: the editor writes the field as the JSON of the links.
  return JSON.parse(field.value) as { label: string; url: string }[];
};

const rows = () => screen.getAllByRole("listitem");

afterEach(() => {
  cleanup();
});

describe("VolumeBookstoreLinksEditor", () => {
  it("posts the links the volume has, in its order", () => {
    render(links);

    expect(postedLinks()).toEqual(links);
    expect(
      screen.getByRole("button", { name: "Reorder Bookstore A" })
    ).toBeTruthy();
  });

  it("says so when the volume has no links", () => {
    render([]);

    expect(
      screen.getByText("This volume has no bookstore links.")
    ).toBeTruthy();
    expect(postedLinks()).toEqual([]);
  });

  it("adds a row at the end and posts what is typed into it", () => {
    render(links.slice(0, 1));

    fireEvent.click(screen.getByRole("button", { name: "Add a link" }));
    const added = within(rows()[1]);
    // A row with no label yet is named by its place in the list.
    expect(added.getByRole("button", { name: "Remove Link 2" })).toBeTruthy();
    fireEvent.change(added.getByRole("textbox", { name: "Label" }), {
      target: { value: "Bookstore B" },
    });
    fireEvent.change(added.getByRole("textbox", { name: "URL" }), {
      target: { value: "https://shop.example.net/v1" },
    });

    expect(postedLinks()).toEqual(links);
  });

  it("takes out the row its remove button belongs to", () => {
    render(links);

    fireEvent.click(screen.getByRole("button", { name: "Remove Bookstore A" }));

    expect(postedLinks()).toEqual(links.slice(1));
  });

  it("stops adding at ten links", () => {
    render(
      Array.from({ length: 10 }, (_, index) => ({
        label: `Bookstore ${index + 1}`,
        url: `https://books.example.com/${index + 1}`,
      }))
    );

    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Add a link" })
        .disabled
    ).toBe(true);
    expect(
      screen.getByText("A volume can have up to 10 bookstore links.")
    ).toBeTruthy();
  });

  it("shows a refusal on the row it names", async () => {
    const message =
      "Enter a URL that starts with https:// and is at most 2,048 characters for link 2.";

    render(links, () =>
      Promise.resolve({
        fieldErrors: { "bookstore_links[1].url": message },
        message,
        ok: false,
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // The form repeats it under the list, so it is looked for on the row.
    expect(await within(rows()[1]).findByText(message)).toBeTruthy();
    expect(within(rows()[0]).queryByText(message)).toBeNull();
  });
});
