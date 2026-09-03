// @vitest-environment jsdom

import { cleanup, render as renderBase, screen } from "@testing-library/react";
import React from "react";
import { afterEach, expect, it, vi } from "vitest";

import { AdminLocaleProvider } from "#components/admin-locale-context";

import { EpisodeForm } from "./episode-form";

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

/**
 * Next.js keeps recently visited pages mounted inside a hidden `<Activity>`
 * for its router bfcache, so two episode create forms can sit in the document
 * at the same time.
 */
const renderBothForms = () =>
  render(
    <>
      <EpisodeForm
        action={action}
        seriesPublicId="SERIES001"
        timeZone="Asia/Tokyo"
      />
      <EpisodeForm
        action={action}
        seriesPublicId="SERIES002"
        timeZone="Asia/Tokyo"
      />
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

  const titles = screen.getAllByLabelText<HTMLInputElement>(/タイトル/u);

  expect(titles).toHaveLength(2);
  expect(titles.map((input) => input.value)).toEqual(["", ""]);
});

it("finds each input by its role and label", () => {
  renderBothForms();

  expect(screen.getAllByRole("textbox", { name: /タイトル/u })).toHaveLength(2);
  expect(screen.getAllByRole("spinbutton", { name: /価格/u })).toHaveLength(2);
  expect(
    screen.getAllByRole("spinbutton", { name: /閲覧可能期間/u })
  ).toHaveLength(2);
  expect(screen.getAllByLabelText(/publish_at/u)).toHaveLength(2);
});
