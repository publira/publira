// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import type { FormHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UNNARROWED_SERIES_SEARCH } from "#lib/series-filters";

import { CatalogSearchForm } from "./catalog-search-form";

const { mockListPublishedGenres } = vi.hoisted(() => ({
  mockListPublishedGenres: vi.fn(),
}));

// `next/form` needs the App Router; a plain form submits the same fields.
vi.mock("next/form", () => ({
  default: (props: FormHTMLAttributes<HTMLFormElement>) => <form {...props} />,
}));

vi.mock("#lib/catalog", () => ({
  SEARCH_QUERY_MAX_LENGTH: 100,
  listPublishedGenres: mockListPublishedGenres,
}));

vi.mock("#lib/locale", () => ({
  getLocale: () => Promise.resolve("en"),
  localePath: (path: string) => Promise.resolve(path),
}));

vi.mock("#lib/messages", () => ({
  getMessagesFor: () =>
    Promise.resolve(bindMessages(sharedCatalog("en"), "en")),
}));

vi.mock("#lib/tenant-id", () => ({
  getTenantId: () => Promise.resolve("tenant"),
}));

afterEach(cleanup);

const GENRE_ID = "SeedGENRAAA1";

const renderForm = async (genre = "") =>
  render(
    await CatalogSearchForm({
      defaultFilters: { ...UNNARROWED_SERIES_SEARCH, genre },
      defaultQuery: "Seed",
      id: "catalog-search-test",
    })
  );

describe("CatalogSearchForm", () => {
  it("offers the tenant's genres beside the other filters", async () => {
    mockListPublishedGenres.mockResolvedValueOnce({
      ok: true,
      value: [{ locale: "en", name: "Action", publicId: GENRE_ID }],
    });

    await renderForm(GENRE_ID);

    expect(screen.getByRole("combobox", { name: "Genre" })).toHaveProperty(
      "value",
      GENRE_ID
    );
    expect(screen.getByRole("combobox", { name: "Sort" })).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says the genres could not be read rather than offering none", async () => {
    mockListPublishedGenres.mockResolvedValueOnce({
      message: "Could not load the genre list. Please try again later.",
      ok: false,
    });

    const { container } = await renderForm(GENRE_ID);

    expect(screen.queryByRole("combobox", { name: "Genre" })).toBeNull();
    expect(screen.getByRole("status").textContent).toContain(
      "Could not load the genre list."
    );
    // The other filters stay usable.
    expect(screen.getByRole("combobox", { name: "Status" })).toBeTruthy();
    // The genre the search is already narrowed by goes with the next
    // submission instead of being dropped.
    expect(
      container.querySelector<HTMLInputElement>('input[name="genre"]')?.value
    ).toBe(GENRE_ID);
  });

  it("draws no genre control for a tenant that curates none", async () => {
    mockListPublishedGenres.mockResolvedValueOnce({ ok: true, value: [] });

    const { container } = await renderForm();

    expect(screen.queryByRole("combobox", { name: "Genre" })).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(container.querySelector('input[name="genre"]')).toBeNull();
  });
});
