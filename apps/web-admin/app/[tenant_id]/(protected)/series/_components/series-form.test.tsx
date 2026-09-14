// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { Locale, MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render as renderBase, screen } from "@testing-library/react";
import React from "react";
import { afterEach, expect, it, vi } from "vitest";

import { AdminLocaleProvider } from "#components/admin-locale-context";

import type { SeriesListItem } from "../series-types";
import { SeriesForm } from "./series-form";

const mockLocale = vi.hoisted(() => ({ current: "en" as Locale }));

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog(mockLocale.current))(message, values),
}));

vi.mock("#lib/messages", () => ({
  getMessagesFor: () =>
    Promise.resolve(bindMessages(sharedCatalog(mockLocale.current))),
  loadAdminMessages: () => Promise.resolve(sharedCatalog(mockLocale.current)),
}));

vi.mock("#components/client-message", () => ({
  ClientMessage: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog(mockLocale.current))(message, values),
  useClientMessages: () => bindMessages(sharedCatalog(mockLocale.current)),
}));

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
const creatorRoles = [
  { name: "Original Author", publicId: "ROLE001" },
  { name: "Artist", publicId: "ROLE002" },
];
const genres = [
  { name: "Fantasy", publicId: "GENRE001" },
  { name: "Mystery", publicId: "GENRE002" },
];
const tagSuggestions = ["seaside", "letterpress"];

const series: SeriesListItem = {
  ageRating: "r15",
  creatorCredits: [{ creatorPublicId: "CREATOR001", rolePublicId: "ROLE002" }],
  creatorNames: ["Creator A"],
  eyeCatchImageUpdatedAt: "",
  eyeCatchImageVariants: [],
  genrePublicIds: ["GENRE002"],
  isPublished: false,
  labelName: "Label A",
  labelPublicId: "LABEL001",
  publicId: "SERIES001",
  publishedAt: "",
  readingPeriodHours: 72,
  scheduleWeekdays: [1, 4],
  status: "hiatus",
  synopsis: "A synopsis",
  tagNames: ["letterpress"],
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
        creatorRoles={creatorRoles}
        creators={creators}
        defaultReadingPeriodHours={72}
        genres={genres}
        labels={labels}
        mode="create"
        tagSuggestions={tagSuggestions}
        timeZone="Asia/Tokyo"
      />
      <SeriesForm
        action={action}
        creatorRoles={creatorRoles}
        creators={creators}
        defaultReadingPeriodHours={72}
        genres={genres}
        initialSeries={series}
        labels={labels}
        mode="update"
        tagSuggestions={tagSuggestions}
        timeZone="Asia/Tokyo"
      />
    </>
  );

/** What the form would post under one field name, in document order. */
const posted = (name: string) =>
  [
    ...document.querySelectorAll<HTMLInputElement>(
      `input[type="hidden"][name="${name}"]`
    ),
  ].map((input) => input.value);

afterEach(() => {
  mockLocale.current = "en";
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
it("finds each input by its role and label", async () => {
  renderBothForms();

  expect(screen.getAllByRole("textbox", { name: /Title/u })).toHaveLength(2);
  expect(screen.getAllByRole("textbox", { name: /Synopsis/u })).toHaveLength(2);
  expect(
    screen.getAllByRole("spinbutton", { name: /Reading period/u })
  ).toHaveLength(2);
  expect(screen.getAllByRole("combobox", { name: /Label/u })).toHaveLength(2);
  // "Authors" is the group the two sit in, so each is matched exactly.
  expect(screen.getAllByRole("combobox", { name: "Author" })).toHaveLength(2);
  expect(screen.getAllByLabelText(/Publication date/u)).toHaveLength(2);
  // The weekday names come from `Intl` and are on screen at once; the labels of
  // the classification controls are catalog strings, each behind a `<Suspense>`
  // of its own, so they arrive once `<ClientMessage>` has the catalog.
  expect(screen.getAllByRole("checkbox", { name: "Mon" })).toHaveLength(2);
  expect(
    await screen.findAllByRole("combobox", { name: /Genres/u })
  ).toHaveLength(2);
  // A text input carrying a `list` is a combobox rather than a textbox: the
  // datalist of tags already in use is what the role names.
  expect(
    await screen.findAllByRole("combobox", { name: /Tags/u })
  ).toHaveLength(2);
  expect(
    await screen.findAllByRole("combobox", { name: /Serialization status/u })
  ).toHaveLength(2);
  expect(
    await screen.findAllByRole("combobox", { name: /Age rating/u })
  ).toHaveLength(2);
  expect(
    await screen.findAllByRole("combobox", { name: /Comments/u })
  ).toHaveLength(2);
});

// The classification the API stored is what the form opens on. Without this a
// save that only fixed a typo would post the column defaults back over it —
// `UpdateSeries` writes the whole listing row.
it("opens on the classification the series carries", () => {
  render(
    <SeriesForm
      action={action}
      creatorRoles={creatorRoles}
      creators={creators}
      defaultReadingPeriodHours={72}
      genres={genres}
      initialSeries={series}
      labels={labels}
      mode="update"
      tagSuggestions={tagSuggestions}
      timeZone="Asia/Tokyo"
    />
  );

  expect(posted("status")).toEqual(["hiatus"]);
  expect(posted("age_rating")).toEqual(["r15"]);
  expect(posted("schedule_weekdays")).toEqual(["1", "4"]);
  expect(posted("genre_public_ids")).toEqual(["GENRE002"]);
  expect(posted("creator_credits")).toEqual([
    JSON.stringify([
      { creatorPublicId: "CREATOR001", rolePublicId: "ROLE002" },
    ]),
  ]);
  expect(posted("tag_names")).toEqual(["letterpress"]);
  expect(screen.getByRole("checkbox", { name: "Mon" }).dataset.checked).toBe(
    ""
  );
  expect(screen.getByRole("checkbox", { name: "Tue" }).dataset.checked).toBe(
    undefined
  );
});

// The mode the series states is what the form opens on, for the reason the
// classification is: `UpdateSeries` writes the whole listing row, so a save
// that carried the default back would reopen commenting on a title that had it
// turned off.
it("opens on the comment mode the series states", () => {
  render(
    <SeriesForm
      action={action}
      creatorRoles={creatorRoles}
      creators={creators}
      defaultReadingPeriodHours={72}
      genres={genres}
      initialCommentMode="disabled"
      initialSeries={series}
      labels={labels}
      mode="update"
      tagSuggestions={tagSuggestions}
      timeZone="Asia/Tokyo"
    />
  );

  expect(posted("comment_mode")).toEqual(["disabled"]);
});

// A series that states nothing follows its tenant, so the option that says so
// names what the tenant currently publishes comments under — otherwise an
// editor has to open the settings screen to find out what they are choosing.
it("names the tenant's own mode in the option that follows it", async () => {
  render(
    <SeriesForm
      action={action}
      creatorRoles={creatorRoles}
      creators={creators}
      defaultReadingPeriodHours={72}
      genres={genres}
      labels={labels}
      mode="create"
      tagSuggestions={tagSuggestions}
      tenantCommentMode="approval_required"
      timeZone="Asia/Tokyo"
    />
  );

  expect(posted("comment_mode")).toEqual([""]);
  expect(
    await screen.findByText(
      "Follow the tenant setting (Publish after approval)"
    )
  ).toBeDefined();
});

// The tenant read can fail, and a mode named there would be read as the
// tenant's own choice, so the option says only that it follows the tenant.
it("leaves that option unnamed when the tenant setting could not be read", async () => {
  render(
    <SeriesForm
      action={action}
      creatorRoles={creatorRoles}
      creators={creators}
      defaultReadingPeriodHours={72}
      genres={genres}
      labels={labels}
      mode="create"
      tagSuggestions={tagSuggestions}
      timeZone="Asia/Tokyo"
    />
  );

  expect(await screen.findByText("Follow the tenant setting")).toBeDefined();
});

// A series with no weekly schedule says so, rather than showing seven empty
// checkboxes and leaving an editor to guess what that means.
it("names the empty schedule as irregular", async () => {
  render(
    <SeriesForm
      action={action}
      creatorRoles={creatorRoles}
      creators={creators}
      defaultReadingPeriodHours={72}
      genres={genres}
      labels={labels}
      mode="create"
      tagSuggestions={tagSuggestions}
      timeZone="Asia/Tokyo"
    />
  );

  expect(await screen.findByText(/presented as irregular/u)).toBeDefined();
});

// The `ja` mirror of the assertions above, which all run under the `en`
// provider. Without it a form that ignored the provider and always read the
// `en` catalog would still pass every one of them.
it("renders in the tenant locale handed down by the protected layout, so locale=ja is Japanese", () => {
  mockLocale.current = "ja";

  renderBase(
    <AdminLocaleProvider locale="ja">
      <SeriesForm
        action={action}
        creatorRoles={creatorRoles}
        creators={creators}
        defaultReadingPeriodHours={72}
        genres={genres}
        labels={labels}
        mode="create"
        tagSuggestions={tagSuggestions}
        timeZone="Asia/Tokyo"
      />
    </AdminLocaleProvider>
  );

  expect(screen.getByRole("textbox", { name: /タイトル/u })).toBeDefined();
  expect(screen.getByRole("button", { name: "シリーズを作成" })).toBeDefined();
  // The weekday names come from `Intl` rather than from the catalog, so the
  // provider's locale has to reach them too.
  expect(screen.getByRole("checkbox", { name: "月" })).toBeDefined();
});

// A credit written before roles existed states none, and a save has no way to
// say that. The form opens it on the tenant's leading role, so the editor sees
// what is about to be stored instead of having the save refused over a field
// nothing on screen mentions.
it("opens a credit that states no role on the tenant's leading role", () => {
  render(
    <SeriesForm
      action={action}
      creatorRoles={creatorRoles}
      creators={creators}
      defaultReadingPeriodHours={72}
      genres={genres}
      initialSeries={{
        ...series,
        creatorCredits: [{ creatorPublicId: "CREATOR001", rolePublicId: "" }],
      }}
      labels={labels}
      mode="update"
      tagSuggestions={tagSuggestions}
      timeZone="Asia/Tokyo"
    />
  );

  expect(posted("creator_credits")).toEqual([
    JSON.stringify([
      { creatorPublicId: "CREATOR001", rolePublicId: "ROLE001" },
    ]),
  ]);
});
