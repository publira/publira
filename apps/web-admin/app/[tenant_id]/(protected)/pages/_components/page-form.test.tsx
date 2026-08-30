// @vitest-environment jsdom

import { cleanup, render as renderBase, screen } from "@testing-library/react";
import React from "react";
import { afterEach, expect, it, vi } from "vitest";

import { AdminLocaleProvider } from "#components/admin-locale-context";

import type { PageListItem } from "../page-types";
import { PageForm } from "./page-form";

vi.mock("#lib/use-tenant-id", () => ({
  useTenantId: () => "TENANT001",
}));

const action = () => Promise.resolve(null);

const render = (ui: React.ReactNode) =>
  renderBase(ui, {
    wrapper: ({ children }) => (
      <AdminLocaleProvider locale="ja">{children}</AdminLocaleProvider>
    ),
  });

const page: PageListItem = {
  createdAt: "2030-01-01T00:00:00Z",
  displayInFooter: false,
  id: "PAGE001",
  publishedVersionId: "",
  slug: "/privacy",
  title: "プライバシーポリシー",
  updatedAt: "2030-01-01T00:00:00Z",
};

/**
 * Next.js keeps recently visited pages mounted inside a hidden `<Activity>`
 * for its router bfcache, so the create form and the edit form are in the
 * document at the same time (#1011).
 */
const renderBothForms = () =>
  render(
    <>
      <PageForm action={action} mode="create" />
      <PageForm action={action} initialPage={page} mode="update" />
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

  const titles = screen.getAllByLabelText<HTMLInputElement>(/タイトル/u);

  expect(titles).toHaveLength(2);
  expect(titles.map((input) => input.value)).toEqual(["", page.title]);
});
