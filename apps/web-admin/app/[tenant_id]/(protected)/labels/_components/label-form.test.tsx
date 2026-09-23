// @vitest-environment jsdom

import { sharedCatalog } from "@publira/i18n/catalog";
import {
  cleanup,
  fireEvent,
  render as renderBase,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { afterEach, expect, it, vi } from "vitest";

import { AdminLocaleProvider } from "#components/admin-locale-context";

import type { LabelActionState, LabelListItem } from "../label-types";
import { LabelForm } from "./label-form";

vi.mock("#lib/use-tenant-id", () => ({
  useTenantId: () => "TENANT001",
}));

const action = () => Promise.resolve(null);

const render = (ui: React.ReactNode) =>
  renderBase(ui, {
    wrapper: ({ children }) => (
      <AdminLocaleProvider locale="en" messages={sharedCatalog("en")}>
        {children}
      </AdminLocaleProvider>
    ),
  });

const label: LabelListItem = {
  eyeCatchImageUpdatedAt: "",
  eyeCatchImageVariants: [],
  name: "Existing Label",
  publicId: "LABEL001",
};

/**
 * Next.js keeps recently visited pages mounted inside a hidden `<Activity>`
 * for its router bfcache, so the create form and the edit form are in the
 * document at the same time.
 */
const renderBothForms = () =>
  render(
    <>
      <LabelForm action={action} mode="create" />
      <LabelForm action={action} initialLabel={label} mode="update" />
    </>
  );

afterEach(() => {
  cleanup();
});

it("keeps the ids unique when it is mounted twice", () => {
  renderBothForms();

  const ids = [...document.querySelectorAll("[id]")].map(
    (element) => element.id
  );

  expect(ids.length).toBeGreaterThan(0);
  expect(ids).toHaveLength(new Set(ids).size);
});

it("points each label at its own input when it is mounted twice", () => {
  renderBothForms();

  const names = screen.getAllByLabelText<HTMLInputElement>(/Label name/u);

  expect(names).toHaveLength(2);
  expect(names.map((input) => input.value)).toEqual(["", label.name]);
});

// The Action carries the name and the image the form held when it was
// submitted, so a change made while it is in flight would not be the label
// that gets created.
it("closes the fields while the save is in flight", async () => {
  // Never resolved: the assertions are about the window the save is open in.
  const save = Promise.withResolvers<LabelActionState>();
  const pendingAction = vi.fn(() => save.promise);

  render(<LabelForm action={pendingAction} mode="create" />);

  const name = screen.getByLabelText<HTMLInputElement>(/Label name/u);
  const image = screen.getByLabelText<HTMLInputElement>("Label cover image");
  fireEvent.change(name, { target: { value: "Monthly Novels" } });

  expect(name.disabled).toBe(false);
  expect(image.disabled).toBe(false);

  fireEvent.click(screen.getByRole("button", { name: "Create label" }));

  await waitFor(() => {
    expect(name.disabled).toBe(true);
    expect(image.disabled).toBe(true);
  });
});
