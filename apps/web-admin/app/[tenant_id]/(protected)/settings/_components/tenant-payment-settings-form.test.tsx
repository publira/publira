// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render as renderBase,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleProvider } from "#components/admin-locale-context";
import { emptyTenantPaymentSettings } from "#lib/payment-settings-shared";
import type { TenantPaymentSettings } from "#lib/payment-settings-shared";

import type { TenantPaymentSettingsFormState } from "../settings-types";
import { TenantPaymentSettingsForm } from "./tenant-payment-settings-form";

vi.mock("next/navigation", () => ({
  useParams: () => ({ tenant_id: "TENANT001" }),
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

const noopAction = (): Promise<TenantPaymentSettingsFormState> =>
  Promise.resolve(null);

const render = (ui: ReactNode) =>
  renderBase(ui, {
    wrapper: ({ children }) => (
      <AdminLocaleProvider locale="en">{children}</AdminLocaleProvider>
    ),
  });

afterEach(() => {
  cleanup();
});

describe("TenantPaymentSettingsForm", () => {
  it("shows an unconfigured tenant as its own status", () => {
    render(
      <TenantPaymentSettingsForm
        action={noopAction}
        canEdit
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
        action={noopAction}
        canEdit
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
        action={noopAction}
        canEdit
        initialSettings={incompleteSettings}
      />
    );

    expect(screen.getByText("Incomplete")).toBeDefined();
  });

  it("shows a saved but disabled configuration as disabled", () => {
    render(
      <TenantPaymentSettingsForm
        action={noopAction}
        canEdit
        initialSettings={disabledSettings}
      />
    );

    expect(screen.getByText("Disabled")).toBeDefined();
  });

  it("stays read-only for someone who is not a tenant admin", () => {
    render(
      <TenantPaymentSettingsForm
        action={noopAction}
        canEdit={false}
        initialSettings={readySettings}
      />
    );

    expect(
      screen.getByLabelText<HTMLInputElement>("Enable Stripe payments").disabled
    ).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled
    ).toBe(true);
    expect(
      screen.getAllByRole<HTMLButtonElement>("button", { name: "Change" })[0]
        ?.disabled
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
        action={noopAction}
        canEdit
        initialSettings={emptyTenantPaymentSettings}
        loadErrorMessage="You do not have permission to perform this action."
      />
    );

    expect(
      screen.getByText("You do not have permission to perform this action.")
    ).toBeDefined();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled
    ).toBe(true);
  });

  it("turns the fields write-only and keeps the hint once change is pressed", () => {
    render(
      <TenantPaymentSettingsForm
        action={noopAction}
        canEdit
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
    const action = vi.fn().mockResolvedValue({
      message: "secret is required",
      ok: false,
    } satisfies TenantPaymentSettingsFormState);

    render(
      <TenantPaymentSettingsForm
        action={action}
        canEdit
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
    const action = vi.fn().mockResolvedValue({
      message: "The payment settings were saved.",
      ok: true,
      settings: {
        ...readySettings,
        secretKeyHint: "sk_test_••••••••NEW1",
      },
    } satisfies TenantPaymentSettingsFormState);

    render(
      <TenantPaymentSettingsForm
        action={action}
        canEdit
        initialSettings={readySettings}
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

    await waitFor(() => {
      expect(screen.getByDisplayValue("sk_test_••••••••NEW1")).toBeDefined();
    });
    expect(screen.queryByDisplayValue(leakedSecret)).toBeNull();
    expect(document.body.textContent).not.toContain(leakedSecret);
  });
});
