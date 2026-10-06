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

import { CreatorRoleRenameForm } from "./creator-role-rename-form";

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
  renameCreatorRoleAction: (
    previousState: FormActionState,
    formData: FormData
  ) => rename(previousState, formData),
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

const renderRows = () =>
  render(
    <ul>
      <li data-testid="ROLE001">
        <CreatorRoleRenameForm
          creatorRole={{ id: "ROLE001", name: "Illustrator" }}
          tenantId="TENANT001"
        />
      </li>
      <li data-testid="ROLE002">
        <CreatorRoleRenameForm
          creatorRole={{ id: "ROLE002", name: "Writer" }}
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

describe("CreatorRoleRenameForm", () => {
  it("posts the name typed for the role the row stands for", async () => {
    rename.mockResolvedValue({ message: "Role updated.", ok: true });
    renderRows();

    fireEvent.change(nameField("Illustrator"), {
      target: { value: "Cover Artist" },
    });
    submitRow("ROLE001");

    await waitFor(() => {
      expect(rename).toHaveBeenCalledTimes(1);
    });
    const [[, formData]] = rename.mock.calls;
    expect(formData.get("creator_role_id")).toBe("ROLE001");
    expect(formData.get("name")).toBe("Cover Artist");
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
    const field = nameField("Illustrator");

    expect(field.matches(":disabled")).toBe(false);

    submitRow("ROLE001");

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
      message: "A role with that name already exists.",
      ok: false,
    });
    renderRows();

    fireEvent.change(nameField("Illustrator"), {
      target: { value: "Writer" },
    });
    submitRow("ROLE001");

    expect(
      await within(screen.getByTestId("ROLE001")).findByText(
        "A role with that name already exists."
      )
    ).toBeDefined();
    expect(
      within(screen.getByTestId("ROLE002")).queryByText(
        "A role with that name already exists."
      )
    ).toBeNull();
    expect(nameField("Illustrator").value).toBe("Writer");
  });
});
