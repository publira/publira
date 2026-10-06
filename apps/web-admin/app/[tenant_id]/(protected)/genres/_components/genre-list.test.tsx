// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";

import type { GenreListItem } from "../genre-types";
import { GenreList } from "./genre-list";

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
}));

// A thumbnail's `alt` is resolved from the request's catalog.
vi.mock("#lib/get-messages", () => ({
  getMessages: () => Promise.resolve(bindMessages(sharedCatalog("en"), "en")),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: ComponentProps<"a">) => (
    <a href={href}>{children}</a>
  ),
}));

// The Actions are `"use server"`, so the module they live in cannot be
// evaluated here at all.
vi.mock("../_lib/actions", () => ({
  deleteGenreAction: vi.fn(),
  renameGenreAction: vi.fn(),
  reorderGenresAction: vi.fn(),
}));

// The rename form's name box is an async Server Component, which a client
// render cannot run; a plain box stands in for it.
vi.mock("./genre-rename-form", () => ({
  GenreRenameForm: ({ genre }: { genre: GenreListItem }) => (
    <input aria-label={`Name of ${genre.name}`} defaultValue={genre.name} />
  ),
}));

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

const genres: GenreListItem[] = [
  {
    eyeCatchImageUpdatedAt: "",
    eyeCatchImageVariants: [],
    id: "GENRE001-ID",
    name: "Romance",
    publicId: "GENRE001",
    slug: "romance",
  },
];

const renderList = (canEdit: boolean) =>
  render(
    <AdminLocaleTestProvider locale="en">
      <GenreList canEdit={canEdit} genres={genres} tenantId="TENANT001" />
    </AdminLocaleTestProvider>
  );

afterEach(() => {
  cleanup();
});

describe("GenreList", () => {
  it("offers an editor to rename, reorder, edit, and delete each genre", () => {
    renderList(true);

    expect(
      screen.getByRole("textbox", { name: "Name of Romance" })
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Reorder Romance" })
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Edit" }).getAttribute("href")
    ).toBe("/genres/GENRE001");
  });

  it("offers an auditor only to view each genre", () => {
    renderList(false);

    expect(screen.getByText("Romance")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(
      screen.getByRole("link", { name: "View" }).getAttribute("href")
    ).toBe("/genres/GENRE001");
  });
});
