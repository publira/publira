// @vitest-environment jsdom

import { sharedCatalog } from "@publira/i18n/catalog";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleProvider } from "#components/admin-locale-context";
import type { TenantSmtpSettings } from "#lib/email-settings-shared";

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

const renderForm = async (settings: TenantSmtpSettings) => {
  await act(() => {
    render(
      <TenantEmailSettingsForm
        canEdit
        initialSettings={settings}
        saveAction={noopAction}
        tenantName="Tenant"
        testAction={noopAction}
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
});
