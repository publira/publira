// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CreatorRoleRowActionState } from "../creator-role-types";
import { CreatorRoleDeleteButton } from "./creator-role-delete-button";

const remove =
  vi.fn<
    (
      previousState: CreatorRoleRowActionState,
      formData: FormData
    ) => Promise<CreatorRoleRowActionState>
  >();

// The Action is `"use server"`, so the module it lives in cannot be evaluated
// here at all. What this control is responsible for is asking first, posting
// the role the row stands for, and reporting what comes back.
vi.mock("../_lib/actions", () => ({
  deleteCreatorRoleAction: (
    previousState: CreatorRoleRowActionState,
    formData: FormData
  ) => remove(previousState, formData),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ tenant_id: "TENANT001" }),
}));

const creatorRole = { name: "Original Author", publicId: "ROLE001" };

/** Every string is a `<ClientMessage>`, so the catalog import is awaited. */
const renderButton = async () => {
  await act(() => {
    render(<CreatorRoleDeleteButton creatorRole={creatorRole} />);
  });
  await screen.findByRole("button", { name: "Delete" });
};

/** Both the trigger and the confirmation read "Delete", so the dialog scopes. */
const openConfirmation = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));

  const dialog = within(await screen.findByRole("alertdialog"));
  await dialog.findByRole("button", { name: "Delete" });

  return dialog;
};

const confirmDelete = async () => {
  const dialog = await openConfirmation();
  fireEvent.click(dialog.getByRole("button", { name: "Delete" }));

  await waitFor(() => {
    expect(remove).toHaveBeenCalledTimes(1);
  });
};

beforeEach(() => {
  // The language the console served this document in, which is what
  // `<ClientMessage>` falls back to when no locale cookie names one.
  document.documentElement.lang = "en";
});

afterEach(() => {
  cleanup();
  document.documentElement.lang = "";
});

describe("CreatorRoleDeleteButton", () => {
  it("asks before it removes the role", async () => {
    await renderButton();
    const dialog = await openConfirmation();

    expect(dialog.getByText("Delete this role?")).toBeDefined();
    expect(
      dialog.getByText(
        "Original Author is removed from the priority order. A role that a series or an episode is still credited in cannot be deleted."
      )
    ).toBeDefined();
    expect(remove).not.toHaveBeenCalled();
  });

  it("leaves the role alone when the confirmation is dismissed", async () => {
    await renderButton();
    const dialog = await openConfirmation();

    fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));

    expect(remove).not.toHaveBeenCalled();
  });

  it("posts the role the row stands for", async () => {
    remove.mockResolvedValue({ message: "", ok: true, publicId: "ROLE001" });

    await renderButton();
    await confirmDelete();

    const [firstCall] = remove.mock.calls;
    const [, formData] = firstCall;

    expect(formData.get("public_id")).toBe("ROLE001");
    expect(formData.get("tenant_id")).toBe("TENANT001");
  });

  // The refusal is the outcome the control exists to report: the credits that
  // still name this role are what the editor has to deal with first, and
  // nothing else on the page says so.
  it("shows the refusal when credits still name the role", async () => {
    remove.mockResolvedValue({
      message:
        "A series or an episode is still credited in this role. Re-credit them before deleting it.",
      ok: false,
      publicId: "ROLE001",
    });

    await renderButton();
    await confirmDelete();

    expect(
      await screen.findByText(
        "A series or an episode is still credited in this role. Re-credit them before deleting it."
      )
    ).toBeDefined();
  });

  // A delete that went through takes its row with it, so a success message
  // would be attached to something that is no longer on screen.
  it("says nothing when the delete goes through", async () => {
    remove.mockResolvedValue({
      message: "Role deleted.",
      ok: true,
      publicId: "ROLE001",
    });

    await renderButton();
    await confirmDelete();

    expect(screen.queryByRole("status")).toBeNull();
  });
});
