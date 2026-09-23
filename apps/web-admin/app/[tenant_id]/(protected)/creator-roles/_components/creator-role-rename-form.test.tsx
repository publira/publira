// @vitest-environment jsdom

import { sharedCatalog } from "@publira/i18n/catalog";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleProvider } from "#components/admin-locale-context";

import type { CreatorRoleRowActionState } from "../creator-role-types";
import { CreatorRoleRenameForm } from "./creator-role-rename-form";

// Never resolved: the assertions are about the window the save is open in.
const rename = vi.fn(
  () => Promise.withResolvers<CreatorRoleRowActionState>().promise
);

// The Action is `"use server"`, so the module it lives in cannot be evaluated
// here at all.
vi.mock("../_lib/actions", () => ({
  renameCreatorRoleAction: () => rename(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ tenant_id: "TENANT001" }),
}));

const EnglishConsole = ({ children }: { children: ReactNode }) => (
  <AdminLocaleProvider locale="en" messages={sharedCatalog("en")}>
    {children}
  </AdminLocaleProvider>
);

afterEach(() => {
  cleanup();
});

describe("CreatorRoleRenameForm", () => {
  // The Action carries the name typed when the form was submitted, so an edit
  // made while it is in flight would sit in the field unsaved.
  it("closes the name field while the rename is in flight", async () => {
    await act(() => {
      render(
        <CreatorRoleRenameForm
          creatorRole={{ name: "Illustrator", publicId: "ROLE001" }}
        />,
        {
          wrapper: EnglishConsole,
        }
      );
    });

    const field = await screen.findByRole<HTMLInputElement>("textbox", {
      name: "Name of Illustrator",
    });

    expect(field.disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(field.disabled).toBe(true);
    });
  });
});
