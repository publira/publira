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

import type { PageFormState } from "../page-types";
import { PageForm } from "./page-form";

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

// The slug field names the URL it makes as it is typed, so it reads its copy
// from the catalog the console layout provides.
const render = (ui: ReactNode) =>
  renderBase(ui, {
    wrapper: ({ children }) => (
      <AdminLocaleTestProvider locale="en">{children}</AdminLocaleTestProvider>
    ),
  });

const renderForm = async (
  formAction: Parameters<typeof PageForm>[0]["action"] = action
) => render(await PageForm({ action: formAction, tenantId: "TENANT001" }));

/**
 * Whether a control refuses input, whichever way it says so. A native control
 * its `<fieldset>` closes keeps `disabled` false and matches `:disabled`, and
 * the footer checkbox is a Base UI one that says so with `aria-disabled`.
 */
const isClosed = (element: HTMLElement) =>
  element.matches(":disabled") ||
  element.getAttribute("aria-disabled") === "true";

afterEach(() => {
  cleanup();
});

/**
 * Next.js keeps recently visited pages mounted inside a hidden `<Activity>`
 * for its router bfcache, so the form can be in the document twice.
 */
it("keeps the ids unique when it is mounted twice", async () => {
  const [first, second] = await Promise.all([
    PageForm({ action, tenantId: "TENANT001" }),
    PageForm({ action, tenantId: "TENANT001" }),
  ]);
  render(
    <>
      {first}
      {second}
    </>
  );

  const ids = [...document.querySelectorAll("[id]")].map(
    (element) => element.id
  );

  expect(ids.length).toBeGreaterThan(0);
  expect(ids).toHaveLength(new Set(ids).size);
  expect(screen.getAllByLabelText(/Title/u)).toHaveLength(2);
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

it("names the URL the slug makes, tidied once the field is left", async () => {
  await renderForm();

  fireEvent.change(slugInput() as HTMLInputElement, {
    target: { value: "//help//faq/" },
  });
  // React listens for `focusout` to raise `onBlur`.
  fireEvent.focusOut(slugInput() as HTMLInputElement);

  expect(slugInput()?.value).toBe("/help/faq");
  expect(
    screen.getByText(/The public URL will be \/help\/faq\./u)
  ).toBeDefined();
});

it("shows a slug failure beside the slug field", async () => {
  const failure: PageFormState = {
    fieldErrors: { slug: "The site keeps this path for signing in." },
    message: "Please check the information you entered.",
    ok: false,
  };
  await renderForm(() => Promise.resolve(failure));

  submit();

  const message = await screen.findByText(
    "The site keeps this path for signing in."
  );
  expect(isBesideSlug(message)).toBe(true);
  expect(slugInput()?.getAttribute("aria-invalid")).toBe("true");
  expect(
    isBesideSlug(screen.getByText("Please check the information you entered."))
  ).toBe(false);
});

it("shows any other failure under the fields", async () => {
  const failure: PageFormState = { message: "Could not save.", ok: false };
  await renderForm(() => Promise.resolve(failure));

  submit();

  const message = await screen.findByText(failure.message);
  expect(isBesideSlug(message)).toBe(false);
  expect(slugInput()?.hasAttribute("aria-invalid")).toBe(false);
});

it("posts whether the page is shown in the footer either way", async () => {
  const create = vi.fn(action);
  await renderForm(create);

  submit();

  await waitFor(() => {
    expect(create).toHaveBeenCalledOnce();
  });
  const [, formData] = create.mock.calls[0] as unknown as [
    PageFormState,
    FormData,
  ];
  expect(formData.get("tenant_id")).toBe("TENANT001");
  expect(formData.get("title")).toBe("Help");
  expect(formData.get("display_in_footer")).toBe("false");
});

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
  await renderForm(() => save.promise);

  for (const control of submittedControls()) {
    expect(isClosed(control)).toBe(false);
  }

  submit();

  await waitFor(() => {
    for (const control of submittedControls()) {
      expect(isClosed(control)).toBe(true);
    }
  });
});
