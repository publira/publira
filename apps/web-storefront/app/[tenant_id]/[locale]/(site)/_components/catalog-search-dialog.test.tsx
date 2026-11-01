// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FormEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as CatalogSearchDialog from "./catalog-search-dialog";

afterEach(cleanup);

const renderDialog = ({
  onOuterSubmit = vi.fn(),
}: { onOuterSubmit?: (event: FormEvent) => void } = {}) =>
  render(
    // Stands in for the drawer row, which closes the drawer from the same
    // bubbling submit.
    <div onSubmit={onOuterSubmit}>
      <CatalogSearchDialog.Root>
        <CatalogSearchDialog.Trigger>Search works</CatalogSearchDialog.Trigger>
        <CatalogSearchDialog.Popup>
          <CatalogSearchDialog.Title>Search</CatalogSearchDialog.Title>
          <form
            action="/search"
            onSubmit={(event) => {
              event.preventDefault();
            }}
          >
            <label htmlFor="keyword">Search works</label>
            <input id="keyword" name="q" type="search" />
            <label htmlFor="status">Status</label>
            <select id="status" name="status">
              <option value="">All statuses</option>
              <option value="ongoing">Ongoing</option>
            </select>
            <button type="submit">Search</button>
          </form>
          <CatalogSearchDialog.Close aria-label="Close search" />
        </CatalogSearchDialog.Popup>
      </CatalogSearchDialog.Root>
    </div>
  );

const trigger = () => screen.getByRole("button", { name: "Search works" });

describe("CatalogSearchDialog", () => {
  it("draws one button in place of the field, and nothing of the form", () => {
    renderDialog();

    expect(trigger().getAttribute("aria-haspopup")).toBe("dialog");
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens onto the keyword field, with the filters beside it", async () => {
    renderDialog();

    fireEvent.click(trigger());

    const dialog = await screen.findByRole("dialog", { name: "Search" });
    const field = screen.getByRole("searchbox", { name: "Search works" });

    expect(dialog.contains(field)).toBe(true);
    expect(screen.getByRole("combobox", { name: "Status" })).toBeTruthy();
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(field);
    });
  });

  it("closes on submission and lets the submission bubble on", async () => {
    const onOuterSubmit = vi.fn();
    renderDialog({ onOuterSubmit });

    fireEvent.click(trigger());

    fireEvent.click(await screen.findByRole("button", { name: "Search" }));

    await vi.waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(onOuterSubmit).toHaveBeenCalled();
  });

  it("closes from its close button without searching", async () => {
    const onOuterSubmit = vi.fn();
    renderDialog({ onOuterSubmit });

    fireEvent.click(trigger());
    fireEvent.click(
      await screen.findByRole("button", { name: "Close search" })
    );

    await vi.waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(onOuterSubmit).not.toHaveBeenCalled();
  });

  it("draws the trigger's focus ring", () => {
    renderDialog();

    // jsdom resolves no Tailwind utilities, so the ring is only visible here
    // as the class that declares it.
    expect(trigger().className).toContain("focus-visible:ring-2");
  });
});
