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
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
}));

vi.mock("#lib/get-messages", () => ({
  getMessages: () => Promise.resolve(bindMessages(sharedCatalog("en"), "en")),
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
      seriesReadingPeriodHours: 0,
      tenantId: "TENANT001",
      timeZone: "UTC",
    }),
    EpisodeForm({
      action,
      seriesId: "SERIES002-ID",
      seriesPublicId: "SERIES002",
      seriesReadingPeriodHours: 0,
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
    seriesReadingPeriodHours: 0,
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
    seriesReadingPeriodHours: 0,
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

// The series' reading period is where a new episode's starts, so a series sold
// with a limit does not hand out episodes without one by default.
it("starts the reading period at the series' period", async () => {
  await renderForm({
    action,
    seriesId: "SERIES001-ID",
    seriesPublicId: "SERIES001",
    seriesReadingPeriodHours: 72,
    timeZone: "UTC",
  });

  expect(
    screen.getByRole("spinbutton", { name: /Reading period/u })
  ).toHaveProperty("value", "72");
  expect(
    screen.getByText(/starts at the series' reading period/u)
  ).toBeTruthy();
});

it("says that a publication time already passed publishes the episode as it is created", async () => {
  await renderForm({
    action,
    seriesId: "SERIES001-ID",
    seriesPublicId: "SERIES001",
    seriesReadingPeriodHours: 0,
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
  const save = Promise.withResolvers<EpisodeActionState>();
  const pendingAction = vi.fn(() => save.promise);

  await renderForm({
    action: pendingAction,
    seriesId: "SERIES001-ID",
    seriesPublicId: "SERIES001",
    seriesReadingPeriodHours: 0,
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

  // React entangles every async transition in flight, so a save left pending
  // would hold the next test's submission open too.
  save.resolve(null);
  await waitFor(() => {
    for (const control of submittedControls()) {
      expect(control.matches(":disabled")).toBe(false);
    }
  });
});

const choose = async (select: string, option: string) => {
  const trigger = screen.getByRole("combobox", { name: select });
  fireEvent.click(trigger);
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  fireEvent.keyDown(await screen.findByRole("option", { name: option }), {
    key: "Enter",
  });
};

// A refused submission costs the editor the one field it names, not the rest
// of what they typed.
it("keeps what was entered when the Action refuses the submission", async () => {
  const refuse = vi.fn((): Promise<EpisodeActionState> =>
    Promise.resolve({
      message: "The publication date and time is invalid.",
      mode: "create",
      ok: false,
    })
  );

  await renderForm({
    action: refuse,
    seriesId: "SERIES001-ID",
    seriesPublicId: "SERIES001",
    seriesReadingPeriodHours: 0,
    timeZone: "UTC",
  });

  fireEvent.change(screen.getByRole("textbox", { name: /Title/u }), {
    target: { value: "Chapter 1" },
  });
  fireEvent.change(screen.getByRole("spinbutton", { name: /Price/u }), {
    target: { value: "120" },
  });
  fireEvent.change(
    screen.getByRole("spinbutton", { name: /Reading period/u }),
    {
      target: { value: "72" },
    }
  );
  fireEvent.change(screen.getByLabelText(/Publication date and time/u), {
    target: { value: "2026-10-01T09:00" },
  });
  await choose("Shown on", "Web only");
  await choose("Sold on", "App only");

  fireEvent.click(screen.getByRole("button", { name: "Create episode" }));

  await waitFor(() => {
    expect(
      screen.getByText("The publication date and time is invalid.")
    ).toBeTruthy();
  });
  expect(refuse).toHaveBeenCalledOnce();
  expect(screen.getByRole("textbox", { name: /Title/u })).toHaveProperty(
    "value",
    "Chapter 1"
  );
  expect(screen.getByRole("spinbutton", { name: /Price/u })).toHaveProperty(
    "value",
    "120"
  );
  expect(
    screen.getByRole("spinbutton", { name: /Reading period/u })
  ).toHaveProperty("value", "72");
  expect(screen.getByLabelText(/Publication date and time/u)).toHaveProperty(
    "value",
    "2026-10-01T09:00"
  );
  expect(screen.getByRole("combobox", { name: "Shown on" }).textContent).toBe(
    "Web only"
  );
  expect(screen.getByRole("combobox", { name: "Sold on" }).textContent).toBe(
    "App only"
  );
});
