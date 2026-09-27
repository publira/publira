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
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";
import { emptyTenantPaymentSettings } from "#lib/payment-settings-shared";
import type { TenantPaymentSettings } from "#lib/payment-settings-shared";

import type { TenantPaymentSettingsFormState } from "../payment-types";
import { TenantPaymentSettingsForm } from "./tenant-payment-settings-form";

const { action } = vi.hoisted(() => ({
  action: {
    current: (): Promise<TenantPaymentSettingsFormState> =>
      Promise.resolve(null),
  },
}));

vi.mock("../_lib/actions", () => ({
  updateTenantPaymentSettingsAction: () => action.current(),
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

const readySettings: TenantPaymentSettings = {
  enabled: true,
  provider: "stripe",
  ready: true,
  secretKeyConfigured: true,
  secretKeyHint: "sk_test_••••••••KLMN",
  webhookSecretConfigured: true,
  webhookSecretHint: "whsec_••••••••WXYZ",
};

const incompleteSettings: TenantPaymentSettings = {
  ...emptyTenantPaymentSettings,
  enabled: true,
};

const disabledSettings: TenantPaymentSettings = {
  ...emptyTenantPaymentSettings,
  secretKeyConfigured: true,
  secretKeyHint: "sk_test_••••••••KLMN",
  webhookSecretConfigured: true,
  webhookSecretHint: "whsec_••••••••WXYZ",
};

const render = (ui: ReactNode) =>
  renderBase(ui, {
    wrapper: ({ children }) => (
      <AdminLocaleTestProvider locale="en">{children}</AdminLocaleTestProvider>
    ),
  });

afterEach(() => {
  cleanup();
  action.current = () => Promise.resolve(null);
});

// A control its `<fieldset>` closes keeps `disabled` false and matches
// `:disabled` instead.
const submittedControls = () => [
  screen.getByLabelText("Enable Stripe payments"),
  screen.getByRole("button", { name: "Change" }),
  screen.getByLabelText(/Webhook signing secret/u),
];

describe("TenantPaymentSettingsForm", () => {
  it("shows an unconfigured tenant as its own status", () => {
    render(
      <TenantPaymentSettingsForm
        canEdit
        tenantId="TENANT001"
        initialSettings={emptyTenantPaymentSettings}
      />
    );

    expect(screen.getByText("Not set")).toBeDefined();
    expect(screen.getByLabelText("Secret key")).toBeDefined();
    expect(screen.getByLabelText("Webhook signing secret")).toBeDefined();
  });

  it("shows only the hint and never the plaintext of a usable configuration", () => {
    render(
      <TenantPaymentSettingsForm
        canEdit
        tenantId="TENANT001"
        initialSettings={readySettings}
      />
    );

    expect(screen.getByText("Ready")).toBeDefined();
    expect(screen.getByDisplayValue("sk_test_••••••••KLMN")).toBeDefined();
    expect(screen.getByDisplayValue("whsec_••••••••WXYZ")).toBeDefined();
    expect(screen.queryByDisplayValue(/sk_test_[^•]/u)).toBeNull();
    expect(screen.queryByLabelText("Secret key")?.getAttribute("type")).toBe(
      "text"
    );
  });

  it("reports missing configuration when it is enabled without a secret", () => {
    render(
      <TenantPaymentSettingsForm
        canEdit
        tenantId="TENANT001"
        initialSettings={incompleteSettings}
      />
    );

    expect(screen.getByText("Incomplete")).toBeDefined();
  });

  it("shows a saved but disabled configuration as disabled", () => {
    render(
      <TenantPaymentSettingsForm
        canEdit
        tenantId="TENANT001"
        initialSettings={disabledSettings}
      />
    );

    expect(screen.getByText("Disabled")).toBeDefined();
  });

  it("stays read-only for someone who is not a tenant admin", () => {
    render(
      <TenantPaymentSettingsForm
        canEdit={false}
        tenantId="TENANT001"
        initialSettings={readySettings}
      />
    );

    expect(
      screen
        .getByLabelText<HTMLInputElement>("Enable Stripe payments")
        .matches(":disabled")
    ).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled
    ).toBe(true);
    expect(
      screen
        .getAllByRole<HTMLButtonElement>("button", { name: "Change" })[0]
        ?.matches(":disabled")
    ).toBe(true);
    expect(
      screen.getByText(
        "Only a tenant administrator can change this setting. You have read-only access."
      )
    ).toBeDefined();
  });

  it("blocks editing and shows the reason when the fetch fails", () => {
    render(
      <TenantPaymentSettingsForm
        canEdit
        tenantId="TENANT001"
        initialSettings={emptyTenantPaymentSettings}
        loadErrorMessage="You do not have permission to perform this action. Go back or use an account that does."
      />
    );

    expect(
      screen.getByText(
        "You do not have permission to perform this action. Go back or use an account that does."
      )
    ).toBeDefined();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled
    ).toBe(true);
  });

  it("turns the fields write-only and keeps the hint once change is pressed", () => {
    render(
      <TenantPaymentSettingsForm
        canEdit
        tenantId="TENANT001"
        initialSettings={readySettings}
      />
    );

    fireEvent.click(
      screen.getAllByRole("button", {
        name: "Change",
      })[0] as HTMLButtonElement
    );

    const secretInput = screen.getByLabelText<HTMLInputElement>("Secret key");

    expect(secretInput.type).toBe("password");
    expect(secretInput.value).toBe("");
    expect(screen.getByDisplayValue("whsec_••••••••WXYZ")).toBeDefined();
  });

  it("shows a failed save on the form", async () => {
    action.current = vi.fn().mockResolvedValue({
      message: "secret is required",
      ok: false,
    } satisfies TenantPaymentSettingsFormState);

    render(
      <TenantPaymentSettingsForm
        canEdit
        tenantId="TENANT001"
        initialSettings={disabledSettings}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText("secret is required")).toBeDefined();
    });
  });

  it("drops the typed secret after saving and shows only the hint", async () => {
    const leakedSecret = "plaintext-secret-value";
    const savedSettings = {
      ...readySettings,
      secretKeyHint: "sk_test_••••••••NEW1",
    };
    action.current = vi.fn().mockResolvedValue({
      message: "The payment settings were saved.",
      ok: true,
    } satisfies TenantPaymentSettingsFormState);

    const { rerender } = render(
      <TenantPaymentSettingsForm
        canEdit
        initialSettings={readySettings}
        tenantId="TENANT001"
      />
    );

    fireEvent.click(
      screen.getAllByRole("button", {
        name: "Change",
      })[0] as HTMLButtonElement
    );
    fireEvent.change(screen.getByLabelText("Secret key"), {
      target: { value: leakedSecret },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("The payment settings were saved.");
    expect(screen.queryByDisplayValue(leakedSecret)).toBeNull();

    // The save's `updateTag` redraws the page with the settings it stored.
    rerender(
      <TenantPaymentSettingsForm
        canEdit
        initialSettings={savedSettings}
        tenantId="TENANT001"
      />
    );

    expect(screen.getByDisplayValue("sk_test_••••••••NEW1")).toBeDefined();
    expect(screen.queryByDisplayValue(leakedSecret)).toBeNull();
    expect(document.body.textContent).not.toContain(leakedSecret);
  });

  // The Action carries what the form held when it was submitted, so a change
  // made while it is in flight would sit in the form unsaved.
  it("closes the fields while the save is in flight", async () => {
    // Never resolved: the assertions are about the window the save is open in.
    const save = Promise.withResolvers<TenantPaymentSettingsFormState>();
    action.current = () => save.promise;

    render(
      <TenantPaymentSettingsForm
        canEdit
        tenantId="TENANT001"
        initialSettings={{
          ...incompleteSettings,
          secretKeyConfigured: true,
          secretKeyHint: "sk_test_••••••••KLMN",
        }}
      />
    );

    for (const control of submittedControls()) {
      expect(control.matches(":disabled")).toBe(false);
    }

    fireEvent.change(screen.getByLabelText(/Webhook signing secret/u), {
      target: { value: "whsec_new" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      for (const control of submittedControls()) {
        expect(control.matches(":disabled")).toBe(true);
      }
    });
  });
});
