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
  }) => bindMessages(sharedCatalog("en"))(message, values),
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

const entriesField = () =>
  screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: "Addresses and domains to refuse",
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
  it("opens on the saved switch and one entry per line", () => {
    renderForm();

    expect(listSwitch().getAttribute("aria-checked")).toBe("true");
    expect(entriesField().value).toBe("refused.example\nsomeone@example.com");
    expect(screen.queryByText(NO_LIST_NOTE)).toBeNull();
    expect(submitButton().disabled).toBe(false);
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
    expect(isDisabled(entriesField())).toBe(true);
    expect(isDisabled(listSwitch())).toBe(true);
    expect(entriesField().value).toBe("");
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
    expect(isDisabled(entriesField())).toBe(true);
    expect(submitButton().disabled).toBe(true);
  });

  it("names a line that is neither an address nor a domain once the list is left", () => {
    renderForm();

    fireEvent.change(entriesField(), {
      target: { value: "refused.example\nnot a domain" },
    });
    expect(
      screen.queryByText(
        '"not a domain" is neither an email address nor a domain.'
      )
    ).toBeNull();

    fireEvent.focusOut(entriesField());

    expect(
      screen.getByText(
        '"not a domain" is neither an email address nor a domain.'
      )
    ).toBeTruthy();
    expect(entriesField().getAttribute("aria-invalid")).toBe("true");

    fireEvent.change(entriesField(), {
      target: { value: "refused.example\nnot-a-domain.example" },
    });

    expect(
      screen.queryByText(
        '"not a domain" is neither an email address nor a domain.'
      )
    ).toBeNull();
  });

  it("submits the switch and the list, and then shows the list as stored", async () => {
    renderForm({
      initialSettings: { entries: [], rejectDisposableDomains: false },
    });

    fireEvent.click(listSwitch());
    fireEvent.change(entriesField(), {
      target: { value: "  Refused.Example \n\nrefused.example" },
    });
    fireEvent.click(submitButton());

    await waitFor(() => {
      expect(save.formData).toBeDefined();
    });
    expect(save.formData?.get("reject_disposable_domains")).toBe("on");
    expect(save.formData?.get("entries")).toBe(
      "  Refused.Example \n\nrefused.example"
    );

    save.current.resolve({
      disposableDomainListAvailable: true,
      message: "The refused email addresses were saved.",
      ok: true,
      settings: { entries: ["refused.example"], rejectDisposableDomains: true },
    });

    await waitFor(() => {
      expect(entriesField().value).toBe("refused.example");
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

  it("shows the refusal of the list beside it", async () => {
    renderForm();

    fireEvent.click(submitButton());
    await waitFor(() => {
      expect(save.formData).toBeDefined();
    });
    save.current.resolve({
      fieldErrors: {
        entries:
          "Check the list. Each line must be one email address or domain, and at most 1000 can be listed.",
      },
      message:
        "Check the list. Each line must be one email address or domain, and at most 1000 can be listed.",
      ok: false,
    });

    await waitFor(() => {
      expect(entriesField().getAttribute("aria-invalid")).toBe("true");
    });
    // Kept, so the operator can fix what was refused.
    expect(entriesField().value).toBe("refused.example\nsomeone@example.com");
  });
});
