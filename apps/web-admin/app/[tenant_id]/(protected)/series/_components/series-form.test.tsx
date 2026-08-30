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
      <AdminLocaleProvider locale="ja">{children}</AdminLocaleProvider>
    ),
  });

const labels = [{ name: "レーベルA", publicId: "LABEL001" }];
const creators = [{ name: "クリエイターA", publicId: "CREATOR001" }];

const series: SeriesListItem = {
  creatorNames: ["クリエイターA"],
  creatorPublicIds: ["CREATOR001"],
  eyeCatchImageUpdatedAt: "",
  eyeCatchImageVariants: [],
  isPublished: false,
  labelName: "レーベルA",
  labelPublicId: "LABEL001",
  publicId: "SERIES001",
  publishedAt: "",
  readingPeriodHours: 72,
  synopsis: "概要",
  title: "既存シリーズ",
};

/**
 * Next.js keeps recently visited pages mounted inside a hidden `<Activity>`
 * for its router bfcache, so the create form and the edit form are in the
 * document at the same time (#983).
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
  expect(titles.map((input) => input.value)).toEqual(["", series.title]);
});

// The e2e suite locates these fields by role and label instead of by id, so
// that the hidden bfcache page's fields stay out of its way (`seriesFormFields`
// in `e2e/src/admin.ts`).
it("ロールとラベルから各入力を引ける", () => {
  renderBothForms();

  expect(screen.getAllByRole("textbox", { name: /タイトル/u })).toHaveLength(2);
  expect(screen.getAllByRole("textbox", { name: /概要/u })).toHaveLength(2);
  expect(
    screen.getAllByRole("spinbutton", { name: /閲覧可能期間/u })
  ).toHaveLength(2);
  expect(screen.getAllByRole("combobox", { name: /レーベル/u })).toHaveLength(
    2
  );
  expect(
    screen.getAllByRole("combobox", { name: /クリエイター/u })
  ).toHaveLength(2);
  expect(screen.getAllByLabelText(/公開日時/u)).toHaveLength(2);
});

it("保護レイアウトから渡されたテナントロケールで表示する", () => {
  renderBase(
    <AdminLocaleProvider locale="en">
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

  expect(screen.getByRole("textbox", { name: /Title/u })).toBeDefined();
  expect(screen.getByRole("button", { name: "Create series" })).toBeDefined();
});
