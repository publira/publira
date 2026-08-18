// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, expect, it, vi } from "vitest";

import type { CreatorListItem } from "../creator-types";
import { CreatorForm } from "./creator-form";

vi.mock("#lib/use-tenant-id", () => ({
  useTenantId: () => "TENANT001",
}));

const action = () => Promise.resolve(null);

const creator: CreatorListItem = {
  iconImageFileSizeBytes: 0,
  iconImageUpdatedAt: "",
  iconImageUrl: "",
  name: "既存著者",
  profileText: "プロフィール",
  publicId: "CREATOR001",
};

/**
 * Next.js keeps recently visited pages mounted inside a hidden `<Activity>`
 * for its router bfcache, so the create form and the edit form are in the
 * document at the same time (#1011).
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

it("二重にマウントされても id が重複しない", () => {
  renderBothForms();

  const ids = [...document.querySelectorAll("[id]")].map(
    (element) => element.id
  );

  expect(ids.length).toBeGreaterThan(0);
  expect(ids).toHaveLength(new Set(ids).size);
});

it("二重にマウントされてもラベルがそれぞれの入力を指す", () => {
  renderBothForms();

  const names = screen.getAllByLabelText<HTMLInputElement>(/^名前/u);

  expect(names).toHaveLength(2);
  expect(names.map((input) => input.value)).toEqual(["", creator.name]);
});
