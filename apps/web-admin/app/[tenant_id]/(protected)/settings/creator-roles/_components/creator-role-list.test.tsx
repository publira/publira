// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CreatorRoleListItem,
  CreatorRoleReorderResult,
} from "../creator-role-types";
import { CreatorRoleList } from "./creator-role-list";

const reorder =
  vi.fn<(formData: FormData) => Promise<CreatorRoleReorderResult>>();

// The Actions are `"use server"`, so the module they live in cannot be
// evaluated here at all. What the list is responsible for is the payload it
// hands them, which is why `reorder` is inspected rather than stubbed away.
vi.mock("../_lib/actions", () => ({
  deleteCreatorRoleAction: vi.fn(),
  renameCreatorRoleAction: vi.fn(),
  reorderCreatorRolesAction: (formData: FormData) => reorder(formData),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ tenant_id: "TENANT001" }),
}));

const creatorRoles: CreatorRoleListItem[] = [
  { name: "Original Author", publicId: "ROLE001" },
  { name: "Artist", publicId: "ROLE002" },
  { name: "Writer", publicId: "ROLE003" },
];

/**
 * Every string here is a `<ClientMessage>` that suspends on the catalog it
 * imports, so a render is awaited: `act` lets React flush the commit that
 * follows the `import()` instead of leaving the boundaries on their fallbacks.
 */
const renderList = async (ui: ReactNode) => {
  await act(() => {
    render(ui);
  });
  await screen.findByRole("button", { name: "Move Artist up" });
};

/** The role names in the order the rows are on screen. */
const namesOnScreen = () =>
  screen.getAllByRole<HTMLInputElement>("textbox").map((input) => input.value);

const submittedOrder = (field: string): string[] => {
  const formData = reorder.mock.calls.at(0)?.at(0);
  if (!formData) {
    throw new Error("the reorder Action was never called");
  }
  return JSON.parse(String(formData.get(field))) as string[];
};

beforeEach(() => {
  // The language the console served this document in, which is what
  // `<ClientMessage>` falls back to when no locale cookie names one.
  document.documentElement.lang = "en";
  reorder.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  document.documentElement.lang = "";
});

describe("CreatorRoleList", () => {
  it("lists the roles in priority order and states each position", async () => {
    await renderList(<CreatorRoleList creatorRoles={creatorRoles} />);

    expect(namesOnScreen()).toEqual(["Original Author", "Artist", "Writer"]);
    expect(
      screen.getAllByText(/^Priority /u).map((hint) => hint.textContent)
    ).toEqual(["Priority 1", "Priority 2", "Priority 3"]);
  });

  // The name box carries no visible label — the value in it is the name — so
  // the only thing that names it for a screen reader is the visually hidden
  // label `Field` ties to it.
  it("names each name box after the role it edits", async () => {
    await renderList(<CreatorRoleList creatorRoles={creatorRoles} />);

    expect(
      screen.getByRole<HTMLInputElement>("textbox", {
        name: "Name of Artist",
      }).value
    ).toBe("Artist");
  });

  // Nothing sits above the leading role or below the last one, so the two
  // moves that have nowhere to go are closed rather than left to be refused.
  it("closes the moves that would leave the order", async () => {
    await renderList(<CreatorRoleList creatorRoles={creatorRoles} />);

    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Move Original Author up",
      }).disabled
    ).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Move Writer down",
      }).disabled
    ).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Move Original Author down",
      }).disabled
    ).toBe(false);
  });

  it("posts the whole order it wants beside the one it was showing", async () => {
    await renderList(<CreatorRoleList creatorRoles={creatorRoles} />);

    fireEvent.click(screen.getByRole("button", { name: "Move Artist up" }));

    await waitFor(() => {
      expect(reorder).toHaveBeenCalledTimes(1);
    });
    expect(submittedOrder("creator_role_public_ids")).toEqual([
      "ROLE002",
      "ROLE001",
      "ROLE003",
    ]);
    // The order the buttons were rendered from. The API refuses the write when
    // this no longer matches what the tenant's roles are in.
    expect(submittedOrder("expected_creator_role_public_ids")).toEqual([
      "ROLE001",
      "ROLE002",
      "ROLE003",
    ]);
  });

  it("moves the row as soon as the button is pressed", async () => {
    // Never resolved: the assertion is about the window the write is open in.
    const pending = Promise.withResolvers<CreatorRoleReorderResult>();
    reorder.mockReturnValue(pending.promise);

    await renderList(<CreatorRoleList creatorRoles={creatorRoles} />);

    fireEvent.click(screen.getByRole("button", { name: "Move Artist up" }));

    await waitFor(() => {
      expect(namesOnScreen()).toEqual(["Artist", "Original Author", "Writer"]);
    });
    expect(
      screen.getAllByText(/^Priority /u).map((hint) => hint.textContent)
    ).toEqual(["Priority 1", "Priority 2", "Priority 3"]);
  });

  it("reports a reorder the server refused", async () => {
    reorder.mockResolvedValue({
      message: "The role priority changed somewhere else.",
      ok: false,
    });

    await renderList(<CreatorRoleList creatorRoles={creatorRoles} />);

    fireEvent.click(screen.getByRole("button", { name: "Move Artist up" }));

    expect(
      await screen.findByText("The role priority changed somewhere else.")
    ).toBeDefined();
  });
});
