// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import type { FormActionState } from "@publira/ui-components/action-form";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GenreRenameForm } from "./genre-rename-form";

const rename =
  vi.fn<
    (
      previousState: FormActionState,
      formData: FormData
    ) => Promise<FormActionState>
  >();

// The Action is `"use server"`, so the module it lives in cannot be evaluated
// here at all.
vi.mock("../_lib/actions", () => ({
  renameGenreAction: (previousState: FormActionState, formData: FormData) =>
    rename(previousState, formData),
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

const genre = (id: string, name: string) => ({
  eyeCatchImageUpdatedAt: "",
  eyeCatchImageVariants: [],
  id,
  name,
  publicId: `${id}-public`,
  slug: name.toLowerCase(),
});

const renderRows = () =>
  render(
    <ul>
      <li data-testid="GENRE001">
        <GenreRenameForm
          genre={genre("GENRE001", "Romance")}
          tenantId="TENANT001"
        />
      </li>
      <li data-testid="GENRE002">
        <GenreRenameForm
          genre={genre("GENRE002", "Mystery")}
          tenantId="TENANT001"
        />
      </li>
    </ul>
  );

const nameField = (name: string) =>
  screen.getByRole<HTMLInputElement>("textbox", { name: `Name of ${name}` });

const submitRow = (id: string) => {
  fireEvent.click(within(screen.getByTestId(id)).getByRole("button"));
};

afterEach(() => {
  cleanup();
  rename.mockReset();
});

describe("GenreRenameForm", () => {
  it("posts the name typed for the genre the row stands for", async () => {
    rename.mockResolvedValue({ message: "Genre updated.", ok: true });
    renderRows();

    fireEvent.change(nameField("Romance"), {
      target: { value: "Love Story" },
    });
    submitRow("GENRE001");

    await waitFor(() => {
      expect(rename).toHaveBeenCalledTimes(1);
    });
    const [[, formData]] = rename.mock.calls;
    expect(formData.get("genre_id")).toBe("GENRE001");
    expect(formData.get("name")).toBe("Love Story");
    expect(formData.get("tenant_id")).toBe("TENANT001");
  });

  // The Action carries the name typed when the form was submitted, so an edit
  // made while it is in flight would sit in the field unsaved.
  it("closes the name field while the rename is in flight", async () => {
    // React entangles pending async actions across roots, so the rename is
    // settled before the test ends rather than left running into the next.
    const { promise, resolve } = Promise.withResolvers<FormActionState>();
    rename.mockReturnValue(promise);
    renderRows();
    const field = nameField("Romance");

    expect(field.matches(":disabled")).toBe(false);

    submitRow("GENRE001");

    await waitFor(() => {
      expect(field.matches(":disabled")).toBe(true);
    });

    await act(() => {
      resolve(null);
    });
  });

  // Every row submits to the same Action, and the answer belongs under the
  // one that was pressed.
  it("shows a refusal under its own row and keeps what was typed", async () => {
    rename.mockResolvedValue({
      message: "A genre with that name already exists.",
      ok: false,
    });
    renderRows();

    fireEvent.change(nameField("Romance"), {
      target: { value: "Mystery" },
    });
    submitRow("GENRE001");

    expect(
      await within(screen.getByTestId("GENRE001")).findByText(
        "A genre with that name already exists."
      )
    ).toBeDefined();
    expect(
      within(screen.getByTestId("GENRE002")).queryByText(
        "A genre with that name already exists."
      )
    ).toBeNull();
    expect(nameField("Romance").value).toBe("Mystery");
  });
});
