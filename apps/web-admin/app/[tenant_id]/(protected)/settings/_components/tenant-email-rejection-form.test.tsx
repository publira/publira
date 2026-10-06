// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";

import type { TenantEmailRejectionActionState } from "../settings-types";
import { TenantEmailRejectionForm } from "./tenant-email-rejection-form";

const { save } = vi.hoisted(() => ({
  save: {
    current: Promise.withResolvers<TenantEmailRejectionActionState>(),
    formData: undefined as FormData | undefined,
  },
}));

vi.mock("../_lib/actions", () => ({
  updateTenantEmailRejectionAction: (_state: unknown, formData: FormData) => {
    save.formData = formData;
    return save.current.promise;
  },
}));

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
}));

const SUBMIT = "Save the refused email addresses";
const ADMIN_ONLY =
  "Only a tenant administrator can change this setting. You have read-only access.";
const NO_LIST_NOTE =
  "The platform has no disposable domain list configured, so this switch has no effect until one is.";

const renderForm = (
  props: Partial<Parameters<typeof TenantEmailRejectionForm>[0]> = {}
) =>
  render(
    <AdminLocaleTestProvider locale="en">
      <TenantEmailRejectionForm
        canEdit
        disposableDomainListAvailable
        initialSettings={{
          entries: ["refused.example", "someone@example.com"],
          rejectDisposableDomains: true,
        }}
        tenantId="TENANT001"
        {...props}
      />
    </AdminLocaleTestProvider>
  );

const listSwitch = () =>
  screen.getByRole("switch", { name: "Refuse disposable email domains" });

/** The list's fields, in order. */
const entryFields = () =>
  screen.getAllByRole<HTMLInputElement>("textbox", {
    name: /^Address or domain \d+$/u,
  });

const entryField = (position: number) =>
  screen.getByRole<HTMLInputElement>("textbox", {
    name: `Address or domain ${position}`,
  });

const entryValues = () => entryFields().map((field) => field.value);

const addButton = () =>
  screen.getByRole("button", { name: "Add an address or domain" });

/** A paste into `field`, as the browser dispatches it with the text on the clipboard. */
const paste = (field: HTMLInputElement, text: string) =>
  fireEvent.paste(field, {
    clipboardData: { getData: () => text },
  });

const submitButton = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: SUBMIT });

// A control inside a disabled fieldset keeps its own `disabled` property false.
const isDisabled = (element: HTMLElement) =>
  element.matches(":disabled") ||
  element.getAttribute("aria-disabled") === "true" ||
  Object.hasOwn(element.dataset, "disabled");

afterEach(() => {
  cleanup();
  // A submission left in flight would hold back the next test's transitions.
  save.current.resolve(null);
  save.current = Promise.withResolvers<TenantEmailRejectionActionState>();
  save.formData = undefined;
});

describe("TenantEmailRejectionForm", () => {
  it("opens on the saved switch and one field per entry", () => {
    renderForm();

    expect(listSwitch().getAttribute("aria-checked")).toBe("true");
    expect(entryValues()).toEqual(["refused.example", "someone@example.com"]);
    expect(screen.queryByText(NO_LIST_NOTE)).toBeNull();
    expect(submitButton().disabled).toBe(false);
  });

  it("opens one empty field for a tenant that lists nothing", () => {
    renderForm({
      initialSettings: { entries: [], rejectDisposableDomains: false },
    });

    expect(entryValues()).toEqual([""]);
  });

  it("says the switch does nothing on a platform with no list", () => {
    renderForm({ disposableDomainListAvailable: false });

    expect(screen.getByText(NO_LIST_NOTE)).toBeTruthy();
    // The switch is still saved, so the tenant's choice is waiting for a list.
    expect(isDisabled(listSwitch())).toBe(false);
  });

  // The API does not answer the setting to anyone else, so the card is shown
  // without values rather than with a permission error beside it.
  it("is read-only, with nothing read, for an operator who is not an administrator", () => {
    renderForm({
      canEdit: false,
      disposableDomainListAvailable: undefined,
      initialSettings: undefined,
    });

    expect(screen.getByText(ADMIN_ONLY)).toBeTruthy();
    expect(entryValues()).toEqual([""]);
    expect(isDisabled(entryField(1))).toBe(true);
    expect(isDisabled(listSwitch())).toBe(true);
    expect(isDisabled(addButton())).toBe(true);
    expect(screen.queryByText(NO_LIST_NOTE)).toBeNull();
    expect(submitButton().disabled).toBe(true);
  });

  // A save replaces the whole list, so one sent without the stored list would
  // empty it.
  it("closes every control while the stored list could not be read", () => {
    renderForm({
      disposableDomainListAvailable: undefined,
      initialSettings: undefined,
      loadErrorMessage:
        "Could not load the refused email addresses. Please try again later.",
    });

    expect(
      screen.getByText(
        "Could not load the refused email addresses. Please try again later."
      )
    ).toBeTruthy();
    expect(isDisabled(entryField(1))).toBe(true);
    expect(submitButton().disabled).toBe(true);
  });

  it("adds an empty field to type into, and focuses it", () => {
    renderForm();

    fireEvent.click(addButton());

    expect(entryValues()).toEqual([
      "refused.example",
      "someone@example.com",
      "",
    ]);
    expect(document.activeElement).toBe(entryField(3));
  });

  it("removes a field and keeps one to type into when the last goes", () => {
    renderForm();

    fireEvent.click(
      screen.getByRole("button", { name: "Remove address or domain 1" })
    );
    expect(entryValues()).toEqual(["someone@example.com"]);

    fireEvent.click(
      screen.getByRole("button", { name: "Remove address or domain 1" })
    );
    expect(entryValues()).toEqual([""]);
  });

  it("spreads a paste of several lines over one field per line", () => {
    renderForm({
      initialSettings: {
        entries: ["first.example", "last.example"],
        rejectDisposableDomains: false,
      },
    });
    const field = entryField(1);
    field.setSelectionRange(0, field.value.length);

    paste(field, "  one.example\r\n\r\ntwo@example.com\nnot a domain\n");

    // The first line takes the selection's place, the rest follow it, and the
    // fields after it stay where they were.
    expect(entryValues()).toEqual([
      "one.example",
      "two@example.com",
      "not a domain",
      "last.example",
    ]);
    expect(document.activeElement).toBe(entryField(3));
    // A pasted entry is checked at once, since nobody typed it.
    expect(
      screen.getByText(
        '"not a domain" is neither an email address nor a domain.'
      )
    ).toBeTruthy();
  });

  it("leaves a paste of one line to the browser", () => {
    renderForm();

    const event = paste(entryField(1), "one.example");

    expect(event).toBe(true);
    expect(entryFields()).toHaveLength(2);
  });

  it("names an entry that is neither an address nor a domain once its field is left", () => {
    renderForm();

    fireEvent.change(entryField(2), { target: { value: "not a domain" } });
    expect(
      screen.queryByText(
        '"not a domain" is neither an email address nor a domain.'
      )
    ).toBeNull();

    fireEvent.focusOut(entryField(2));

    expect(
      screen.getByText(
        '"not a domain" is neither an email address nor a domain.'
      )
    ).toBeTruthy();
    expect(entryField(2).getAttribute("aria-invalid")).toBe("true");
    expect(entryField(1).getAttribute("aria-invalid")).toBeNull();

    fireEvent.change(entryField(2), {
      target: { value: "not-a-domain.example" },
    });

    expect(
      screen.queryByText(
        '"not a domain" is neither an email address nor a domain.'
      )
    ).toBeNull();
  });

  it("submits the switch and one entry per field, and then shows the list as stored", async () => {
    renderForm({
      initialSettings: { entries: [], rejectDisposableDomains: false },
    });

    fireEvent.click(listSwitch());
    fireEvent.change(entryField(1), {
      target: { value: "  Refused.Example " },
    });
    fireEvent.click(addButton());
    fireEvent.click(addButton());
    fireEvent.change(entryField(3), { target: { value: "refused.example" } });
    fireEvent.click(submitButton());

    await waitFor(() => {
      expect(save.formData).toBeDefined();
    });
    expect(save.formData?.get("reject_disposable_domains")).toBe("on");
    expect(save.formData?.getAll("entries")).toEqual([
      "  Refused.Example ",
      "",
      "refused.example",
    ]);

    save.current.resolve({
      disposableDomainListAvailable: true,
      message: "The refused email addresses were saved.",
      ok: true,
      settings: { entries: ["refused.example"], rejectDisposableDomains: true },
    });

    await waitFor(() => {
      expect(entryValues()).toEqual(["refused.example"]);
    });
    expect(listSwitch().getAttribute("aria-checked")).toBe("true");
    expect(
      await screen.findByText("The refused email addresses were saved.")
    ).toBeTruthy();
  });

  it("submits nothing for the switch while it is off", async () => {
    renderForm({
      initialSettings: { entries: [], rejectDisposableDomains: false },
    });

    fireEvent.click(submitButton());

    await waitFor(() => {
      expect(save.formData).toBeDefined();
    });
    expect(save.formData?.get("reject_disposable_domains")).toBeNull();
  });

  it("shows the refusal of the list beside it and keeps what was entered", async () => {
    renderForm();

    fireEvent.click(submitButton());
    await waitFor(() => {
      expect(save.formData).toBeDefined();
    });
    const refusal =
      "Check the list. Each entry must be one email address or domain, and at most 1000 can be listed.";
    save.current.resolve({
      fieldErrors: { entries: refusal },
      message: refusal,
      ok: false,
    });

    await waitFor(() => {
      expect(screen.getAllByText(refusal).length).toBeGreaterThan(0);
    });
    expect(entryValues()).toEqual(["refused.example", "someone@example.com"]);
  });
});
