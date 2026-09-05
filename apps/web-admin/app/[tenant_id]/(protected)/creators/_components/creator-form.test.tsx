// @vitest-environment jsdom

import { cleanup, render as renderBase, screen } from "@testing-library/react";
import React from "react";
import { afterEach, expect, it, vi } from "vitest";

import { AdminLocaleProvider } from "#components/admin-locale-context";

import type { CreatorListItem } from "../creator-types";
import { CreatorForm } from "./creator-form";

vi.mock("#lib/use-tenant-id", () => ({
  useTenantId: () => "TENANT001",
}));

const action = () => Promise.resolve(null);

const render = (ui: React.ReactNode) =>
  renderBase(ui, {
    wrapper: ({ children }) => (
      <AdminLocaleProvider locale="en">{children}</AdminLocaleProvider>
    ),
  });

const creator: CreatorListItem = {
  iconImageFileSizeBytes: 0,
  iconImageUpdatedAt: "",
  iconImageUrl: "",
  name: "Existing Creator",
  profileText: "Creator profile",
  publicId: "CREATOR001",
};

/**
 * Next.js keeps recently visited pages mounted inside a hidden `<Activity>`
 * for its router bfcache, so the create form and the edit form are in the
 * document at the same time.
 */
const renderBothForms = () =>
  render(
    <>
      <CreatorForm action={action} mode="create" />
      <CreatorForm action={action} initialCreator={creator} mode="update" />
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

  const names = screen.getAllByLabelText<HTMLInputElement>(/^Name/u);

  expect(names).toHaveLength(2);
  expect(names.map((input) => input.value)).toEqual(["", creator.name]);
});
