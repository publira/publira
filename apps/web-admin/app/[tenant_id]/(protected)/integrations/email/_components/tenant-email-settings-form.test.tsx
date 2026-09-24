// @vitest-environment jsdom

import { sharedCatalog } from "@publira/i18n/catalog";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleProvider } from "#components/admin-locale-context";
import type { TenantSmtpSettings } from "#lib/email-settings-shared";

import type {
  TenantEmailSettingsFormState,
  TenantSmtpTestFormState,
} from "../email-types";
import { TenantEmailSettingsForm } from "./tenant-email-settings-form";

vi.mock("next/navigation", () => ({
  useParams: () => ({ tenant_id: "TENANT001" }),
}));

const noopAction = vi.fn();

const storedSettings = (
  overrides: Partial<TenantSmtpSettings> = {}
): TenantSmtpSettings => ({
  encryption: "starttls",
  fromAddress: "mail@tenant.example",
  fromName: "Tenant Mail",
  hasPassword: true,
  host: "smtp.tenant.example",
  port: 587,
  replyTo: "",
  smtpOverrideEnabled: true,
  username: "tenant-user",
  ...overrides,
});

const EnglishConsole = ({ children }: { children: ReactNode }) => (
  <AdminLocaleProvider locale="en" messages={sharedCatalog("en")}>
    {children}
  </AdminLocaleProvider>
);

const renderForm = async (
  settings: TenantSmtpSettings,
  {
    saveAction = noopAction,
    testAction = noopAction,
  }: {
    saveAction?: () => Promise<TenantEmailSettingsFormState>;
    testAction?: () => Promise<TenantSmtpTestFormState>;
  } = {}
) => {
  await act(() => {
    render(
      <TenantEmailSettingsForm
        canEdit
        initialSettings={settings}
        saveAction={saveAction}
        tenantName="Tenant"
        testAction={testAction}
      />,
      { wrapper: EnglishConsole }
    );
  });
};

const testButton = () =>
  screen.getByRole<HTMLButtonElement>("button", {
    name: "Test the connection",
  });

const overrideCheckbox = () =>
  screen.getByRole<HTMLInputElement>("checkbox", {
    name: /Enable the override/u,
  });

const settingsControls = () => [
  overrideCheckbox(),
  screen.getByRole("textbox", { name: /Host/u }),
  screen.getByRole("spinbutton", { name: /Port/u }),
  screen.getByRole("textbox", { name: /Username/u }),
  screen.getByRole("button", { name: "Change" }),
  screen.getByRole("combobox", { name: /Encryption/u }),
  screen.getByRole("textbox", { name: /Sender name/u }),
  screen.getByRole("textbox", { name: /Sender email address/u }),
  screen.getByRole("textbox", { name: /Reply-to address/u }),
  testButton(),
];

afterEach(() => {
  cleanup();
});

describe("TenantEmailSettingsForm", () => {
  // The test message goes out over the tenant's own SMTP server. A tenant that
  // overrides nothing sends over the platform relay instead, whose settings the
  // platform console owns and tests, and whose credentials the tenant console's
  // database role cannot read.
  it("offers the connection test only while the override is on", async () => {
    await renderForm(storedSettings({ smtpOverrideEnabled: false }));

    expect(testButton().disabled).toBe(true);

    await act(() => {
      fireEvent.click(overrideCheckbox());
    });

    expect(testButton().disabled).toBe(false);
  });

  it("offers the connection test for stored override settings", async () => {
    await renderForm(storedSettings());

    expect(testButton().disabled).toBe(false);
  });

  // A save carries every field the form held when it was submitted, so a
  // change made while it is in flight would sit in the form unsaved. A test
  // started meanwhile would send the fields the save has closed, which a
  // disabled control leaves out of the form, so it waits too.
  it("closes the fields and the connection test while the save is in flight", async () => {
    // Never resolved: the assertions are about the window the save is open in.
    const save = Promise.withResolvers<TenantEmailSettingsFormState>();
    await renderForm(storedSettings(), { saveAction: () => save.promise });

    // A control its `<fieldset>` closes keeps `disabled` false and matches
    // `:disabled` instead.
    for (const control of settingsControls()) {
      expect(control.matches(":disabled")).toBe(false);
    }

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      for (const control of settingsControls()) {
        expect(control.matches(":disabled")).toBe(true);
      }
    });
  });

  // The test carries the recipient chosen when it was started, so a change
  // made while it is in flight would not be where the message went.
  it("closes the recipient while the connection test is in flight", async () => {
    // Never resolved: the assertions are about the window the test is open in.
    const test = Promise.withResolvers<TenantSmtpTestFormState>();
    await renderForm(storedSettings(), { testAction: () => test.promise });

    fireEvent.click(testButton());
    const sendToSelf = await screen.findByRole<HTMLInputElement>("checkbox", {
      name: "Send it to myself",
    });
    fireEvent.click(sendToSelf);
    const recipient = await screen.findByRole<HTMLInputElement>("textbox", {
      name: /Recipient email address/u,
    });
    fireEvent.change(recipient, {
      target: { value: "recipient@example.com" },
    });

    expect(sendToSelf.disabled).toBe(false);
    expect(recipient.disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Run the test" }));

    await waitFor(() => {
      expect(sendToSelf.disabled).toBe(true);
      expect(recipient.disabled).toBe(true);
    });
  });
});
