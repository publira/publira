// @vitest-environment jsdom

import { cleanup, render as renderBase, screen } from "@testing-library/react";
import React from "react";
import { afterEach, expect, it, vi } from "vitest";

import { AdminLocaleProvider } from "#components/admin-locale-context";

import type { SeriesListItem } from "../series-types";
import { SeriesForm } from "./series-form";

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

const labels = [{ name: "Label A", publicId: "LABEL001" }];
const creators = [{ name: "Creator A", publicId: "CREATOR001" }];

const series: SeriesListItem = {
  creatorNames: ["Creator A"],
  creatorPublicIds: ["CREATOR001"],
  eyeCatchImageUpdatedAt: "",
  eyeCatchImageVariants: [],
  isPublished: false,
  labelName: "Label A",
  labelPublicId: "LABEL001",
  publicId: "SERIES001",
  publishedAt: "",
  readingPeriodHours: 72,
  synopsis: "A synopsis",
  title: "Existing Series",
};

/**
 * Next.js keeps recently visited pages mounted inside a hidden `<Activity>`
 * for its router bfcache, so the create form and the edit form are in the
 * document at the same time.
 */
const renderBothForms = () =>
  render(
    <>
      <SeriesForm
        action={action}
        creators={creators}
        defaultReadingPeriodHours={72}
        labels={labels}
        mode="create"
        timeZone="Asia/Tokyo"
      />
      <SeriesForm
        action={action}
        creators={creators}
        defaultReadingPeriodHours={72}
        initialSeries={series}
        labels={labels}
        mode="update"
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

  const titles = screen.getAllByLabelText<HTMLInputElement>(/Title/u);

  expect(titles).toHaveLength(2);
  expect(titles.map((input) => input.value)).toEqual(["", series.title]);
});

// The e2e suite locates these fields by role and label instead of by id, so
// that the hidden bfcache page's fields stay out of its way (`seriesFormFields`
// in `e2e/src/admin.ts`).
it("finds each input by its role and label", () => {
  renderBothForms();

  expect(screen.getAllByRole("textbox", { name: /Title/u })).toHaveLength(2);
  expect(screen.getAllByRole("textbox", { name: /Synopsis/u })).toHaveLength(2);
  expect(
    screen.getAllByRole("spinbutton", { name: /Reading period/u })
  ).toHaveLength(2);
  expect(screen.getAllByRole("combobox", { name: /Label/u })).toHaveLength(2);
  expect(screen.getAllByRole("combobox", { name: /Creators/u })).toHaveLength(
    2
  );
  expect(screen.getAllByLabelText(/Publication date/u)).toHaveLength(2);
});

// The `ja` mirror of the assertions above, which all run under the `en`
// provider. Without it a form that ignored the provider and always read the
// `en` catalog would still pass every one of them.
it("renders in the tenant locale handed down by the protected layout, so locale=ja is Japanese", () => {
  renderBase(
    <AdminLocaleProvider locale="ja">
      <SeriesForm
        action={action}
        creators={creators}
        defaultReadingPeriodHours={72}
        labels={labels}
        mode="create"
        timeZone="Asia/Tokyo"
      />
    </AdminLocaleProvider>
  );

  expect(screen.getByRole("textbox", { name: /タイトル/u })).toBeDefined();
  expect(screen.getByRole("button", { name: "シリーズを作成" })).toBeDefined();
});
