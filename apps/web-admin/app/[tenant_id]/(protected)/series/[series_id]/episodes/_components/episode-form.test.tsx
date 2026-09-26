// @vitest-environment jsdom

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

import type { EpisodeActionState } from "../episode-types";
import { EpisodeForm } from "./episode-form";

vi.mock("#lib/use-tenant-id", () => ({
  useTenantId: () => "TENANT001",
}));

const action = () => Promise.resolve(null);

const render = (ui: React.ReactNode) =>
  renderBase(ui, {
    wrapper: ({ children }) => (
      <AdminLocaleTestProvider locale="en">{children}</AdminLocaleTestProvider>
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
      <EpisodeForm action={action} seriesPublicId="SERIES001" timeZone="UTC" />
      <EpisodeForm action={action} seriesPublicId="SERIES002" timeZone="UTC" />
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
  expect(titles.map((input) => input.value)).toEqual(["", ""]);
});

it("finds each input by its role and label", () => {
  renderBothForms();

  expect(screen.getAllByRole("textbox", { name: /Title/u })).toHaveLength(2);
  expect(screen.getAllByRole("spinbutton", { name: /Price/u })).toHaveLength(2);
  expect(
    screen.getAllByRole("spinbutton", { name: /Reading period/u })
  ).toHaveLength(2);
  expect(screen.getAllByLabelText(/publish_at/u)).toHaveLength(2);
});

// A new episode starts out following its series, and the option says what
// that series is shown on.
it("creates an episode that follows its series unless told otherwise", () => {
  render(
    <EpisodeForm
      action={action}
      seriesAvailability="app"
      seriesPublicId="SERIES001"
      timeZone="UTC"
    />
  );

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
it("creates an episode sold where its series is unless told otherwise", () => {
  render(
    <EpisodeForm
      action={action}
      seriesPublicId="SERIES001"
      seriesPurchaseAvailability="web"
      timeZone="UTC"
    />
  );

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

// A control its `<fieldset>` closes keeps `disabled` false and matches
// `:disabled` instead.
const submittedControls = () => [
  screen.getByRole("textbox", { name: /Title/u }),
  screen.getByRole("spinbutton", { name: /Price/u }),
  screen.getByRole("spinbutton", { name: /Reading period/u }),
  screen.getByLabelText(/publish_at/u),
  screen.getByRole("combobox", { name: "Shown on" }),
  screen.getByRole("combobox", { name: "Sold on" }),
];

// The Action carries what the fields held when the form was submitted, so a
// change made while it is in flight would not be the episode that gets created.
it("closes every field while the save is in flight", async () => {
  // Never resolved: the assertions are about the window the save is open in.
  const save = Promise.withResolvers<EpisodeActionState>();
  const pendingAction = vi.fn(() => save.promise);

  render(
    <EpisodeForm
      action={pendingAction}
      seriesPublicId="SERIES001"
      timeZone="UTC"
    />
  );

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
