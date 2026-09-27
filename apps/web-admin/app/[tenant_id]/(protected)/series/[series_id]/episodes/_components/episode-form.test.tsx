// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import {
  cleanup,
  fireEvent,
  render as renderBase,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";

import type { EpisodeActionState } from "../episode-types";
import { EpisodeForm } from "./episode-form";

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"))(message, values),
}));

vi.mock("#lib/get-messages", () => ({
  getMessages: () => Promise.resolve(bindMessages(sharedCatalog("en"))),
}));

const action = () => Promise.resolve(null);

// The availability fields are client controls, which read their own copy from
// the catalog the console layout provides.
const render = (ui: ReactNode) =>
  renderBase(ui, {
    wrapper: ({ children }) => (
      <AdminLocaleTestProvider locale="en">{children}</AdminLocaleTestProvider>
    ),
  });

const renderForm = async (
  props: Omit<Parameters<typeof EpisodeForm>[0], "tenantId">
) => render(await EpisodeForm({ ...props, tenantId: "TENANT001" }));

/**
 * Next.js keeps recently visited pages mounted inside a hidden `<Activity>`
 * for its router bfcache, so two episode create forms can sit in the document
 * at the same time.
 */
const renderBothForms = async () => {
  const [first, second] = await Promise.all([
    EpisodeForm({
      action,
      seriesId: "SERIES001-ID",
      seriesPublicId: "SERIES001",
      tenantId: "TENANT001",
      timeZone: "UTC",
    }),
    EpisodeForm({
      action,
      seriesId: "SERIES002-ID",
      seriesPublicId: "SERIES002",
      tenantId: "TENANT001",
      timeZone: "UTC",
    }),
  ]);

  render(
    <>
      {first}
      {second}
    </>
  );
};

afterEach(() => {
  cleanup();
});

it("keeps the ids unique when it is mounted twice", async () => {
  await renderBothForms();

  const ids = [...document.querySelectorAll("[id]")].map(
    (element) => element.id
  );

  expect(ids.length).toBeGreaterThan(0);
  expect(ids).toHaveLength(new Set(ids).size);
});

it("points each label at its own input when it is mounted twice", async () => {
  await renderBothForms();

  const titles = screen.getAllByLabelText<HTMLInputElement>(/Title/u);

  expect(titles).toHaveLength(2);
  expect(titles.map((input) => input.value)).toEqual(["", ""]);
});

it("finds each input by its role and label", async () => {
  await renderBothForms();

  expect(screen.getAllByRole("textbox", { name: /Title/u })).toHaveLength(2);
  expect(screen.getAllByRole("spinbutton", { name: /Price/u })).toHaveLength(2);
  expect(
    screen.getAllByRole("spinbutton", { name: /Reading period/u })
  ).toHaveLength(2);
  expect(screen.getAllByLabelText(/Publication date and time/u)).toHaveLength(
    2
  );
});

// A new episode starts out following its series, and the option says what
// that series is shown on.
it("creates an episode that follows its series unless told otherwise", async () => {
  await renderForm({
    action,
    seriesAvailability: "app",
    seriesId: "SERIES001-ID",
    seriesPublicId: "SERIES001",
    timeZone: "UTC",
  });

  expect(
    [
      ...document.querySelectorAll<HTMLInputElement>(
        'input[type="hidden"][name="availability"]'
      ),
    ].map((input) => input.value)
  ).toEqual([""]);
  expect(screen.getByRole("combobox", { name: "Shown on" }).textContent).toBe(
    "Follow the series (App only)"
  );
});

// Where it may be bought follows the series too, and the option names where
// the series sells once the tenant's default has been resolved into it.
it("creates an episode sold where its series is unless told otherwise", async () => {
  await renderForm({
    action,
    seriesId: "SERIES001-ID",
    seriesPublicId: "SERIES001",
    seriesPurchaseAvailability: "web",
    timeZone: "UTC",
  });

  expect(
    [
      ...document.querySelectorAll<HTMLInputElement>(
        'input[type="hidden"][name="purchase_availability"]'
      ),
    ].map((input) => input.value)
  ).toEqual([""]);
  expect(screen.getByRole("combobox", { name: "Sold on" }).textContent).toBe(
    "Follow the series (Web only)"
  );
});

it("says that a publication time already passed publishes the episode as it is created", async () => {
  await renderForm({
    action,
    seriesId: "SERIES001-ID",
    seriesPublicId: "SERIES001",
    timeZone: "Asia/Tokyo",
  });

  expect(
    screen.getByText(
      /time zone \(Asia\/Tokyo\).*already passed publishes it as soon as it is created/u
    )
  ).toBeTruthy();
});

// A control its `<fieldset>` closes keeps `disabled` false and matches
// `:disabled` instead.
const submittedControls = () => [
  screen.getByRole("textbox", { name: /Title/u }),
  screen.getByRole("spinbutton", { name: /Price/u }),
  screen.getByRole("spinbutton", { name: /Reading period/u }),
  screen.getByLabelText(/Publication date and time/u),
  screen.getByRole("combobox", { name: "Shown on" }),
  screen.getByRole("combobox", { name: "Sold on" }),
];

// The Action carries what the fields held when the form was submitted, so a
// change made while it is in flight would not be the episode that gets created.
it("closes every field while the save is in flight", async () => {
  // Never resolved: the assertions are about the window the save is open in.
  const save = Promise.withResolvers<EpisodeActionState>();
  const pendingAction = vi.fn(() => save.promise);

  await renderForm({
    action: pendingAction,
    seriesId: "SERIES001-ID",
    seriesPublicId: "SERIES001",
    timeZone: "UTC",
  });

  fireEvent.change(screen.getByRole("textbox", { name: /Title/u }), {
    target: { value: "Chapter 1" },
  });

  for (const control of submittedControls()) {
    expect(control.matches(":disabled")).toBe(false);
  }

  fireEvent.click(screen.getByRole("button", { name: "Create episode" }));

  await waitFor(() => {
    for (const control of submittedControls()) {
      expect(control.matches(":disabled")).toBe(true);
    }
  });
});
