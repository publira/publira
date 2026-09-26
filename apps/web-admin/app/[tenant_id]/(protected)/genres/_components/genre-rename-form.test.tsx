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
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";

import type { GenreRowActionState } from "../genre-types";
import { GenreRenameForm } from "./genre-rename-form";

// Never resolved: the assertions are about the window the save is open in.
const rename = vi.fn(
  () => Promise.withResolvers<GenreRowActionState>().promise
);

// The Action is `"use server"`, so the module it lives in cannot be evaluated
// here at all.
vi.mock("../_lib/actions", () => ({
  renameGenreAction: () => rename(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ tenant_id: "TENANT001" }),
}));

const EnglishConsole = ({ children }: { children: ReactNode }) => (
  <AdminLocaleTestProvider locale="en">{children}</AdminLocaleTestProvider>
);

afterEach(() => {
  cleanup();
});

describe("GenreRenameForm", () => {
  // The Action carries the name typed when the form was submitted, so an edit
  // made while it is in flight would sit in the field unsaved.
  it("closes the name field while the rename is in flight", async () => {
    await act(() => {
      render(
        <GenreRenameForm
          genre={{
            eyeCatchImageUpdatedAt: "",
            eyeCatchImageVariants: [],
            name: "Romance",
            publicId: "GENRE001",
            slug: "romance",
          }}
        />,
        {
          wrapper: EnglishConsole,
        }
      );
    });

    const field = await screen.findByRole<HTMLInputElement>("textbox", {
      name: "Name of Romance",
    });

    expect(field.disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(field.disabled).toBe(true);
    });
  });
});
