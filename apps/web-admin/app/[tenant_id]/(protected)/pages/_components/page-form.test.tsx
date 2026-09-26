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

import type { PageFormState, PageListItem } from "../page-types";
import { PageForm } from "./page-form";

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

const page: PageListItem = {
  createdAt: "2030-01-01T00:00:00Z",
  displayInFooter: false,
  id: "PAGE001",
  publishedVersionId: "",
  slug: "/privacy",
  title: "Privacy policy",
  updatedAt: "2030-01-01T00:00:00Z",
};

/**
 * Next.js keeps recently visited pages mounted inside a hidden `<Activity>`
 * for its router bfcache, so the create form and the edit form are in the
 * document at the same time.
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
  expect(titles.map((input) => input.value)).toEqual(["", page.title]);
});

const submit = () => {
  // The title is required, so the browser holds an empty form back.
  fireEvent.change(screen.getByLabelText(/Title/u), {
    target: { value: "Help" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create page" }));
};

const slugInput = () =>
  document.querySelector<HTMLInputElement>('input[name="slug"]');

/** Whether `message` sits between the slug input and the title input. */
const isBesideSlug = (message: HTMLElement): boolean => {
  const order = [...document.querySelectorAll("*")];
  const at = (element: Element | null) =>
    element ? order.indexOf(element) : -1;
  const slug = at(slugInput());
  const title = at(screen.getByLabelText<HTMLInputElement>(/Title/u));
  return slug < at(message) && at(message) < title;
};

it("shows a slug failure beside the slug field rather than above the button", async () => {
  const failure: PageFormState = {
    field: "slug",
    message: "The site keeps this path for signing in.",
    ok: false,
  };
  render(<PageForm action={() => Promise.resolve(failure)} mode="create" />);

  submit();

  const message = await screen.findByText(failure.message);
  expect(isBesideSlug(message)).toBe(true);
  expect(slugInput()?.getAttribute("aria-invalid")).toBe("true");
});

it("shows any other failure above the button", async () => {
  const failure: PageFormState = { message: "Could not save.", ok: false };
  render(<PageForm action={() => Promise.resolve(failure)} mode="create" />);

  submit();

  const message = await screen.findByText(failure.message);
  expect(isBesideSlug(message)).toBe(false);
  expect(slugInput()?.hasAttribute("aria-invalid")).toBe(false);
});

// A control its `<fieldset>` closes keeps `disabled` false and matches
// `:disabled` instead.
const submittedControls = () => [
  screen.getByRole("textbox", { name: "slug" }),
  screen.getByRole("textbox", { name: /Title/u }),
  screen.getByRole("checkbox", { name: "Show in footer" }),
  screen.getByRole("textbox", { name: "Content" }),
];

// The Action carries what the fields held when the form was submitted, so a
// change made while it is in flight would not be the page that gets created.
it("closes every field while the save is in flight", async () => {
  // Never resolved: the assertions are about the window the save is open in.
  const save = Promise.withResolvers<PageFormState>();
  render(<PageForm action={() => save.promise} mode="create" />);

  for (const control of submittedControls()) {
    expect(control.matches(":disabled")).toBe(false);
  }

  submit();

  await waitFor(() => {
    for (const control of submittedControls()) {
      expect(control.matches(":disabled")).toBe(true);
    }
  });
});
