// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { Locale, MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import {
  cleanup,
  fireEvent,
  render as renderBase,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { afterEach, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";

import type { SeriesActionState, SeriesListItem } from "../series-types";
import { SeriesForm } from "./series-form";

const mockLocale = vi.hoisted(() => ({ current: "en" as Locale }));

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) =>
    bindMessages(sharedCatalog(mockLocale.current), mockLocale.current)(
      message,
      values
    ),
}));

vi.mock("#lib/messages", () => ({
  getMessagesFor: () =>
    Promise.resolve(
      bindMessages(sharedCatalog(mockLocale.current), mockLocale.current)
    ),
  loadAdminMessages: () => Promise.resolve(sharedCatalog(mockLocale.current)),
}));

vi.mock("#components/client-message", () => ({
  ClientMessage: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) =>
    bindMessages(sharedCatalog(mockLocale.current), mockLocale.current)(
      message,
      values
    ),
  useClientMessages: () =>
    bindMessages(sharedCatalog(mockLocale.current), mockLocale.current),
}));

const action = () => Promise.resolve(null);

const render = (ui: React.ReactNode) =>
  renderBase(ui, {
    wrapper: ({ children }) => (
      <AdminLocaleTestProvider locale="en">{children}</AdminLocaleTestProvider>
    ),
  });

const labels = [{ id: "LABEL001", name: "Label A" }];
const creators = [{ id: "CREATOR001", name: "Creator A" }];
const creatorRoles = [
  { id: "ROLE001", name: "Original Author" },
  { id: "ROLE002", name: "Artist" },
];
const genres = [
  { id: "GENRE001", name: "Fantasy" },
  { id: "GENRE002", name: "Mystery" },
];
const tagSuggestions = ["seaside", "letterpress"];

const series: SeriesListItem = {
  ageRating: "r15",
  availability: "app",
  creatorCredits: [{ creatorId: "CREATOR001", roleId: "ROLE002", shareBps: 0 }],
  eyeCatchImageUpdatedAt: "",
  eyeCatchImageVariants: [],
  genreIds: ["GENRE002"],
  id: "SERIES001-ID",
  isPublished: false,
  labelId: "LABEL001",
  labelName: "Label A",
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
        synopsisPlaceholder="Synopsis"
        tagSuggestions={tagSuggestions}
        tenantId="TENANT001"
        timeZone="UTC"
        titlePlaceholder="Title"
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
        synopsisPlaceholder="Synopsis"
        tagSuggestions={tagSuggestions}
        tenantId="TENANT001"
        timeZone="UTC"
        titlePlaceholder="Title"
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
it("finds each input by its role and label", () => {
  renderBothForms();

  expect(screen.getAllByRole("textbox", { name: /Title/u })).toHaveLength(2);
  expect(screen.getAllByRole("textbox", { name: /Synopsis/u })).toHaveLength(2);
  expect(
    screen.getAllByRole("spinbutton", { name: /Reading period/u })
  ).toHaveLength(2);
  expect(screen.getAllByRole("combobox", { name: /Label/u })).toHaveLength(2);
  // The create form opens with no credits and the edit form with the one the
  // series carries, so this pair is the edit form's only row.
  expect(screen.getAllByRole("combobox", { name: "Author 1" })).toHaveLength(1);
  expect(screen.getAllByRole("combobox", { name: "Role 1" })).toHaveLength(1);
  expect(screen.getAllByLabelText(/Publication date/u)).toHaveLength(2);
  expect(screen.getAllByRole("checkbox", { name: "Mon" })).toHaveLength(2);
  expect(screen.getAllByRole("combobox", { name: /Genres/u })).toHaveLength(2);
  // A text input carrying a `list` is a combobox rather than a textbox: the
  // datalist of tags already in use is what the role names.
  expect(screen.getAllByRole("combobox", { name: /Tags/u })).toHaveLength(2);
  expect(
    screen.getAllByRole("combobox", { name: /Serialization status/u })
  ).toHaveLength(2);
  expect(screen.getAllByRole("combobox", { name: /Age rating/u })).toHaveLength(
    2
  );
  expect(screen.getAllByRole("combobox", { name: /Comments/u })).toHaveLength(
    2
  );
});

// The classification the API stored is what the form opens on. Without this a
// save that only fixed a typo would post the column defaults back over it —
// the form states every listing field it offers.
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
      synopsisPlaceholder="Synopsis"
      tagSuggestions={tagSuggestions}
      tenantId="TENANT001"
      timeZone="UTC"
      titlePlaceholder="Title"
    />
  );

  expect(posted("status")).toEqual(["hiatus"]);
  expect(posted("age_rating")).toEqual(["r15"]);
  expect(posted("schedule_weekdays")).toEqual(["1", "4"]);
  expect(posted("genre_ids")).toEqual(["GENRE002"]);
  expect(posted("creator_credits")).toEqual([
    JSON.stringify([
      { creatorId: "CREATOR001", roleId: "ROLE002", shareBps: 0 },
    ]),
  ]);
  expect(posted("tag_names")).toEqual(["letterpress"]);
  expect(screen.getByRole("checkbox", { name: "Mon" }).dataset.checked).toBe(
    ""
  );
  expect(
    screen.getByRole("checkbox", { name: "Tue" }).dataset.checked
  ).toBeUndefined();
});

// The mode the series states is what the form opens on, for the reason the
// classification is: the form states the mode on every save, so a save that
// carried the default back would reopen commenting on a title that had it
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
      synopsisPlaceholder="Synopsis"
      tagSuggestions={tagSuggestions}
      tenantId="TENANT001"
      timeZone="UTC"
      titlePlaceholder="Title"
    />
  );

  expect(posted("comment_mode")).toEqual(["disabled"]);
});

// `UpdateSeries` stores the default for a direction left out, so the form has
// to open on — and post back — the layout the series holds.
it("opens on the layout the series states", () => {
  render(
    <SeriesForm
      action={action}
      creatorRoles={creatorRoles}
      creators={creators}
      defaultReadingPeriodHours={72}
      genres={genres}
      initialReadingLayout={{ readingDirection: "ltr", spreadStartIndex: 0 }}
      initialSeries={series}
      labels={labels}
      mode="update"
      synopsisPlaceholder="Synopsis"
      tagSuggestions={tagSuggestions}
      tenantId="TENANT001"
      timeZone="UTC"
      titlePlaceholder="Title"
    />
  );

  expect(posted("reading_direction")).toEqual(["ltr"]);
  expect(
    screen.getByRole<HTMLInputElement>("spinbutton", {
      name: /Spreads start at page/u,
    }).value
  ).toBe("1");
});

it("opens a new series on the layout the viewers use today", async () => {
  render(
    <SeriesForm
      action={action}
      creatorRoles={creatorRoles}
      creators={creators}
      defaultReadingPeriodHours={72}
      genres={genres}
      labels={labels}
      mode="create"
      synopsisPlaceholder="Synopsis"
      tagSuggestions={tagSuggestions}
      tenantId="TENANT001"
      timeZone="UTC"
      titlePlaceholder="Title"
    />
  );

  expect(posted("reading_direction")).toEqual(["rtl"]);
  expect(
    screen.getByRole<HTMLInputElement>("spinbutton", {
      name: /Spreads start at page/u,
    }).value
  ).toBe("2");
  expect(
    await screen.findByRole("combobox", { name: /Reading direction/u })
  ).toBeDefined();
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
      synopsisPlaceholder="Synopsis"
      tagSuggestions={tagSuggestions}
      tenantCommentMode="approval_required"
      tenantId="TENANT001"
      timeZone="UTC"
      titlePlaceholder="Title"
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
      synopsisPlaceholder="Synopsis"
      tagSuggestions={tagSuggestions}
      tenantId="TENANT001"
      timeZone="UTC"
      titlePlaceholder="Title"
    />
  );

  const comments = await screen.findByRole("combobox", { name: /Comments/u });
  expect(comments.textContent).toBe("Follow the tenant setting");
});

// Where the series' episodes may be bought is carried back on every save, for
// the reason the comment mode is: the form offers following the tenant as a
// choice, and opening on it would write that over the series' own value.
it("opens on where the series states its episodes are sold", async () => {
  render(
    <SeriesForm
      action={action}
      creatorRoles={creatorRoles}
      creators={creators}
      defaultReadingPeriodHours={72}
      genres={genres}
      initialPurchaseAvailability="app"
      initialSeries={series}
      labels={labels}
      mode="update"
      synopsisPlaceholder="Synopsis"
      tagSuggestions={tagSuggestions}
      tenantId="TENANT001"
      tenantPurchaseAvailability="all"
      timeZone="UTC"
      titlePlaceholder="Title"
    />
  );

  expect(posted("purchase_availability")).toEqual(["app"]);
  const soldOn = await screen.findByRole("combobox", { name: /Sold on/u });
  expect(soldOn.textContent).toBe("App only");
});

// A series that states nothing follows its tenant, so the option names where
// the tenant sells — the operator is not left to look it up on the settings
// screen.
it("names where the tenant sells in the option that follows it", async () => {
  render(
    <SeriesForm
      action={action}
      creatorRoles={creatorRoles}
      creators={creators}
      defaultReadingPeriodHours={72}
      genres={genres}
      labels={labels}
      mode="create"
      synopsisPlaceholder="Synopsis"
      tagSuggestions={tagSuggestions}
      tenantId="TENANT001"
      tenantPurchaseAvailability="web"
      timeZone="UTC"
      titlePlaceholder="Title"
    />
  );

  expect(posted("purchase_availability")).toEqual([""]);
  const soldOn = await screen.findByRole("combobox", { name: /Sold on/u });
  expect(soldOn.textContent).toBe("Follow the tenant setting (Web only)");
});

it("leaves where the tenant sells unnamed when it could not be read", async () => {
  render(
    <SeriesForm
      action={action}
      creatorRoles={creatorRoles}
      creators={creators}
      defaultReadingPeriodHours={72}
      genres={genres}
      labels={labels}
      mode="create"
      synopsisPlaceholder="Synopsis"
      tagSuggestions={tagSuggestions}
      tenantId="TENANT001"
      timeZone="UTC"
      titlePlaceholder="Title"
    />
  );

  const soldOn = await screen.findByRole("combobox", { name: /Sold on/u });
  expect(soldOn.textContent).toBe("Follow the tenant setting");
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
      synopsisPlaceholder="Synopsis"
      tagSuggestions={tagSuggestions}
      tenantId="TENANT001"
      timeZone="UTC"
      titlePlaceholder="Title"
    />
  );

  expect(await screen.findByText(/presented as irregular/u)).toBeDefined();
});

// Editing the credit list is editing the template the next episode is baked
// from, so the form says as much rather than leaving an editor to assume a save
// re-credits the episodes that already shipped.
it("says that the credits reach episodes created from now on", () => {
  render(
    <SeriesForm
      action={action}
      creatorRoles={creatorRoles}
      creators={creators}
      defaultReadingPeriodHours={72}
      genres={genres}
      labels={labels}
      mode="create"
      synopsisPlaceholder="Synopsis"
      tagSuggestions={tagSuggestions}
      tenantId="TENANT001"
      timeZone="UTC"
      titlePlaceholder="Title"
    />
  );

  expect(
    screen.getByText(/template new episodes are created from/u)
  ).toBeDefined();
});

// The wall clock is read in the zone the form was rendered in, and the instant
// it names is what the Action receives, so a change to the tenant zone made in
// another tab cannot move the date that was typed.
it("posts the publication date as the instant its wall clock names", () => {
  render(
    <SeriesForm
      action={action}
      creatorRoles={creatorRoles}
      creators={creators}
      defaultReadingPeriodHours={72}
      genres={genres}
      initialSeries={{ ...series, publishedAt: "2030-01-01T00:00:00Z" }}
      labels={labels}
      mode="update"
      synopsisPlaceholder="Synopsis"
      tagSuggestions={tagSuggestions}
      tenantId="TENANT001"
      timeZone="Asia/Tokyo"
      titlePlaceholder="Title"
    />
  );
  const publicationDate =
    screen.getByLabelText<HTMLInputElement>(/Publication date/u);

  expect(publicationDate.value).toBe("2030-01-01T09:00");
  expect(posted("published_at")).toEqual(["2030-01-01T00:00:00Z"]);

  fireEvent.change(publicationDate, { target: { value: "2030-02-03T04:05" } });

  expect(posted("published_at")).toEqual(["2030-02-02T19:05:00Z"]);

  fireEvent.change(publicationDate, { target: { value: "" } });

  expect(posted("published_at")).toEqual([""]);
});

// The share boxes sit in a field of their own, and the save button belongs to
// the form around it.
it("disables the save while the credit shares pass 100%", () => {
  render(
    <SeriesForm
      action={action}
      creatorRoles={creatorRoles}
      creators={creators}
      defaultReadingPeriodHours={72}
      genres={genres}
      initialSeries={{
        ...series,
        creatorCredits: [
          {
            creatorId: "CREATOR001",
            roleId: "ROLE001",
            shareBps: 0,
          },
          {
            creatorId: "CREATOR001",
            roleId: "ROLE002",
            shareBps: 0,
          },
        ],
      }}
      labels={labels}
      mode="update"
      synopsisPlaceholder="Synopsis"
      tagSuggestions={tagSuggestions}
      tenantId="TENANT001"
      timeZone="Asia/Tokyo"
      titlePlaceholder="Title"
    />
  );
  const save = screen.getByRole<HTMLButtonElement>("button", {
    name: "Update series",
  });

  fireEvent.change(screen.getByRole("textbox", { name: "Share of author 1" }), {
    target: { value: "60" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Share of author 2" }), {
    target: { value: "50" },
  });

  expect(save.disabled).toBe(true);

  fireEvent.change(screen.getByRole("textbox", { name: "Share of author 2" }), {
    target: { value: "40" },
  });

  expect(save.disabled).toBe(false);
});

/**
 * Whether a control refuses input, whichever way it says so. A native control
 * closed by its `<fieldset>` keeps `disabled` false and matches `:disabled`.
 */
const isClosed = (element: HTMLElement) =>
  element.matches(":disabled") ||
  element.getAttribute("aria-disabled") === "true" ||
  Object.hasOwn(element.dataset, "disabled");

const submittedControls = async () => [
  screen.getByRole("textbox", { name: /Title/u }),
  screen.getByRole("textbox", { name: /Synopsis/u }),
  screen.getByRole("spinbutton", { name: /Reading period/u }),
  screen.getByRole("combobox", { name: /Label/u }),
  screen.getByRole("combobox", { name: "Author 1" }),
  screen.getByRole("combobox", { name: "Role 1" }),
  screen.getByRole("textbox", { name: "Share of author 1" }),
  screen.getByLabelText(/Publication date/u),
  screen.getByRole("checkbox", { name: "Mon" }),
  await screen.findByRole("combobox", { name: /Genres/u }),
  await screen.findByRole("combobox", { name: /Tags/u }),
  await screen.findByRole("combobox", { name: /Serialization status/u }),
  await screen.findByRole("combobox", { name: /Age rating/u }),
  await screen.findByRole("combobox", { name: /Comments/u }),
];

// The Action carries what the form held when it was submitted, so any change
// made while it is in flight would sit in the form under the success message
// unsaved.
it("closes every field while the save is in flight", async () => {
  // Never resolved: the assertions are about the window the save is open in.
  const save = Promise.withResolvers<SeriesActionState>();
  const pendingAction = vi.fn(() => save.promise);

  render(
    <SeriesForm
      action={pendingAction}
      creatorRoles={creatorRoles}
      creators={creators}
      defaultReadingPeriodHours={72}
      genres={genres}
      initialSeries={series}
      labels={labels}
      mode="update"
      synopsisPlaceholder="Synopsis"
      tagSuggestions={tagSuggestions}
      tenantId="TENANT001"
      timeZone="UTC"
      titlePlaceholder="Title"
    />
  );

  for (const control of await submittedControls()) {
    expect(isClosed(control)).toBe(false);
  }

  fireEvent.click(screen.getByRole("button", { name: "Update series" }));

  await waitFor(async () => {
    for (const control of await submittedControls()) {
      expect(isClosed(control)).toBe(true);
    }
  });
});

// The `ja` mirror of the assertions above, which all run under the `en`
// provider. Without it a form that ignored the provider and always read the
// `en` catalog would still pass every one of them.
it("renders in the tenant locale handed down by the protected layout, so locale=ja is Japanese", () => {
  mockLocale.current = "ja";

  renderBase(
    <AdminLocaleTestProvider locale="ja">
      <SeriesForm
        action={action}
        creatorRoles={creatorRoles}
        creators={creators}
        defaultReadingPeriodHours={72}
        genres={genres}
        labels={labels}
        mode="create"
        synopsisPlaceholder="Synopsis"
        tagSuggestions={tagSuggestions}
        tenantId="TENANT001"
        timeZone="UTC"
        titlePlaceholder="Title"
      />
    </AdminLocaleTestProvider>
  );

  expect(screen.getByRole("textbox", { name: /タイトル/u })).toBeDefined();
  expect(screen.getByRole("button", { name: "シリーズを作成" })).toBeDefined();
  // The weekday names come from `Intl` rather than from the catalog, so the
  // provider's locale has to reach them too.
  expect(screen.getByRole("checkbox", { name: "月" })).toBeDefined();
});

// The label is sent as its internal ID, which nobody types, so a failed label
// read leaves the picker with its error instead of a text box.
it("shows the label read error beside the picker and keeps the series' label", () => {
  const { container } = render(
    <SeriesForm
      action={action}
      creatorRoles={creatorRoles}
      creators={creators}
      defaultReadingPeriodHours={72}
      genres={genres}
      initialSeries={series}
      labels={[]}
      labelsErrorMessage="Could not load the labels."
      mode="update"
      synopsisPlaceholder="Synopsis"
      tagSuggestions={tagSuggestions}
      tenantId="TENANT001"
      timeZone="UTC"
      titlePlaceholder="Title"
    />
  );

  expect(screen.getByText("Could not load the labels.")).toBeDefined();
  // The read failed, so the list being empty says nothing about the tenant.
  expect(screen.queryByRole("link", { name: "Create a label" })).toBeNull();
  expect(
    container.querySelector<HTMLInputElement>('input[name="label_id"]')?.type
  ).toBe("hidden");
  expect(
    container.querySelector<HTMLInputElement>('input[name="label_id"]')?.value
  ).toBe(series.labelId);
});

it("does not point an operator who may not create a label at the screen that makes one", () => {
  render(
    <SeriesForm
      action={action}
      canCreateLabel={false}
      creatorRoles={creatorRoles}
      creators={creators}
      defaultReadingPeriodHours={72}
      genres={genres}
      labels={[]}
      mode="update"
      synopsisPlaceholder="Synopsis"
      tagSuggestions={tagSuggestions}
      tenantId="TENANT001"
      timeZone="UTC"
      titlePlaceholder="Title"
    />
  );

  expect(
    screen.getByText("A series needs a label, and this tenant has none yet.", {
      exact: false,
    })
  ).toBeDefined();
  expect(screen.queryByRole("link", { name: "Create a label" })).toBeNull();
});

it("points a tenant with no labels at creating one while keeping the picker", () => {
  render(
    <SeriesForm
      action={action}
      creatorRoles={creatorRoles}
      creators={creators}
      defaultReadingPeriodHours={72}
      genres={genres}
      labels={[]}
      mode="create"
      synopsisPlaceholder="Synopsis"
      tagSuggestions={tagSuggestions}
      tenantId="TENANT001"
      timeZone="UTC"
      titlePlaceholder="Title"
    />
  );

  expect(screen.getByRole("combobox", { name: /Label/u })).toBeDefined();
  expect(
    screen.getByText("A series needs a label, and this tenant has none yet.", {
      exact: false,
    })
  ).toBeDefined();
  expect(
    screen.getByRole("link", { name: "Create a label" }).getAttribute("href")
  ).toBe("/labels/new");
  expect(
    screen.queryByText("Select a label to associate with this series.")
  ).toBeNull();
});
