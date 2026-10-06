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
import type {
  PaymentProvider,
  TenantPaymentSettings,
} from "#lib/payment-settings-shared";

import type { TenantPaymentSettingsFormState } from "../payment-types";
import { TenantPaymentSettingsForm } from "./tenant-payment-settings-form";

const { action } = vi.hoisted(() => ({
  action: {
    current: (
      _state: TenantPaymentSettingsFormState,
      _formData: FormData
    ): Promise<TenantPaymentSettingsFormState> => Promise.resolve(null),
  },
}));

vi.mock("../_lib/actions", () => ({
  updateTenantPaymentSettingsAction: (
    state: TenantPaymentSettingsFormState,
    formData: FormData
  ) => action.current(state, formData),
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

const stripe: PaymentProvider = {
  displayName: "Stripe",
  fields: [
    { name: "secret_key", public: false, required: true, secret: true },
    { name: "webhook_secret", public: false, required: true, secret: true },
  ],
  id: "stripe",
  webhookPath: "/api/v1/webhook/payment/stripe",
};

const payjp: PaymentProvider = {
  displayName: "PAY.JP",
  fields: [
    { name: "secret_key", public: false, required: true, secret: true },
    { name: "webhook_token", public: false, required: true, secret: true },
  ],
  id: "payjp",
  webhookPath: "/api/v1/webhook/payment/payjp",
};

// A provider no catalog has copy for, so its fields are named as declared.
const examplePay: PaymentProvider = {
  displayName: "Example Pay",
  fields: [
    { name: "secret_key", public: false, required: true, secret: true },
    { name: "public_key", public: true, required: true, secret: false },
    { name: "webhook_token", public: false, required: false, secret: true },
  ],
  id: "examplepay",
  webhookPath: "/api/v1/webhook/payment/examplepay",
};

const providers = [examplePay, stripe];

const stripeFields = (
  secretKeyHint: string,
  webhookSecretHint: string
): TenantPaymentSettings["fields"] => [
  {
    configured: secretKeyHint !== "",
    hint: secretKeyHint,
    name: "secret_key",
  },
  {
    configured: webhookSecretHint !== "",
    hint: webhookSecretHint,
    name: "webhook_secret",
  },
];

const readySettings: TenantPaymentSettings = {
  enabled: true,
  fields: stripeFields("sk_test_••••••••KLMN", "whsec_••••••••WXYZ"),
  provider: "stripe",
  ready: true,
};

const incompleteSettings: TenantPaymentSettings = {
  ...emptyTenantPaymentSettings,
  enabled: true,
  fields: stripeFields("", ""),
  provider: "stripe",
};

const disabledSettings: TenantPaymentSettings = {
  ...emptyTenantPaymentSettings,
  fields: stripeFields("sk_test_••••••••KLMN", "whsec_••••••••WXYZ"),
  provider: "stripe",
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

/**
 * Whether a control refuses input, whichever way it says so. A native control
 * its `<fieldset>` closes keeps `disabled` false and matches `:disabled`, and
 * the payments checkbox is a Base UI one that says so with `aria-disabled`.
 */
const isClosed = (element: HTMLElement) =>
  element.matches(":disabled") ||
  element.getAttribute("aria-disabled") === "true";

const paymentsCheckbox = () =>
  screen.getByRole("checkbox", { name: "Enable payments" });

const submittedControls = () => [
  paymentsCheckbox(),
  screen.getByRole("button", { name: "Change" }),
  screen.getByLabelText(/Webhook signing secret/u),
];

describe("TenantPaymentSettingsForm", () => {
  it("shows an unconfigured tenant as its own status", () => {
    render(
      <TenantPaymentSettingsForm
        providers={[stripe]}
        canEdit
        tenantId="TENANT001"
        initialSettings={emptyTenantPaymentSettings}
      />
    );

    expect(screen.getByText("Not set")).toBeDefined();
    expect(screen.getByLabelText("Secret key")).toBeDefined();
    expect(screen.getByLabelText("Webhook signing secret")).toBeDefined();
  });

  it("renders every field another provider declares and shows a public one as stored", () => {
    render(
      <TenantPaymentSettingsForm
        providers={providers}
        canEdit
        tenantId="TENANT001"
        initialSettings={{
          enabled: false,
          fields: [
            {
              configured: true,
              hint: "sk_test_••••••••KLMN",
              name: "secret_key",
            },
            { configured: true, hint: "pk_test_4242", name: "public_key" },
            { configured: false, hint: "", name: "webhook_token" },
          ],
          provider: "examplepay",
          ready: false,
        }}
      />
    );

    expect(
      screen.getByRole("combobox", { name: "Payment provider" }).textContent
    ).toContain("Example Pay");
    expect(screen.getByLabelText<HTMLInputElement>("secret_key").value).toBe(
      "sk_test_••••••••KLMN"
    );
    const publicKey = screen.getByLabelText<HTMLInputElement>("public_key");
    expect(publicKey.type).toBe("text");
    expect(publicKey.value).toBe("pk_test_4242");
    expect(screen.getByLabelText<HTMLInputElement>("webhook_token").type).toBe(
      "password"
    );
    expect(screen.queryByLabelText("Webhook signing secret")).toBeNull();
  });

  it("names PAY.JP's fields and tells where each comes from and where the webhook goes", () => {
    render(
      <TenantPaymentSettingsForm
        providers={[payjp, stripe]}
        canEdit
        tenantId="TENANT001"
        initialSettings={{
          ...emptyTenantPaymentSettings,
          fields: [
            { configured: false, hint: "", name: "secret_key" },
            { configured: false, hint: "", name: "webhook_token" },
          ],
          provider: "payjp",
        }}
        webhookOrigin="https://comics.example"
      />
    );

    expect(screen.getByLabelText("Secret key")).toBeDefined();
    expect(screen.getByLabelText("Webhook token")).toBeDefined();
    expect(
      screen.getByText(
        "The secret key (sk_live_… or sk_test_…) on the API settings page of the PAY.JP dashboard. A test key takes test payments only."
      )
    ).toBeDefined();
    expect(
      screen.getByText(
        "The webhook token (whook_…) shown in the account settings of the PAY.JP dashboard."
      )
    ).toBeDefined();
    expect(
      screen.getByDisplayValue(
        "https://comics.example/api/v1/webhook/payment/payjp"
      )
    ).toBeDefined();
    expect(
      screen.getByText(
        "PAY.JP sends every notification with the webhook token stored above, and one that does not carry it is refused."
      )
    ).toBeDefined();
  });

  it("shows the chosen provider's fields and webhook URL, and warns that the stored credentials go", async () => {
    render(
      <TenantPaymentSettingsForm
        providers={providers}
        canEdit
        tenantId="TENANT001"
        initialSettings={readySettings}
        webhookOrigin="https://comics.example"
      />
    );

    expect(
      screen.getByDisplayValue(
        "https://comics.example/api/v1/webhook/payment/stripe"
      )
    ).toBeDefined();
    expect(
      screen.queryByText(
        "Saving with a different provider deletes the credentials stored for Stripe."
      )
    ).toBeNull();

    const select = screen.getByRole("combobox", { name: "Payment provider" });
    fireEvent.click(select);
    fireEvent.keyDown(select, { key: "ArrowDown" });
    fireEvent.keyDown(
      await screen.findByRole("option", { name: "Example Pay" }),
      { key: "Enter" }
    );

    await screen.findByText(
      "Saving with a different provider deletes the credentials stored for Stripe."
    );
    // Payments are on, so the label carries the required marker.
    expect(screen.getByLabelText(/^public_key/u)).toBeDefined();
    expect(screen.queryByDisplayValue("sk_test_••••••••KLMN")).toBeNull();
    expect(
      screen.getByDisplayValue(
        "https://comics.example/api/v1/webhook/payment/examplepay"
      )
    ).toBeDefined();
    expect(
      screen.getByText(
        "Register this URL with Example Pay as where it sends payment notifications."
      )
    ).toBeDefined();
  });

  it("posts each credential with what the form did to it", async () => {
    const submit = vi.fn<typeof action.current>().mockResolvedValue(null);
    action.current = submit;

    render(
      <TenantPaymentSettingsForm
        providers={providers}
        canEdit
        tenantId="TENANT001"
        initialSettings={{
          enabled: true,
          fields: [
            {
              configured: true,
              hint: "sk_test_••••••••KLMN",
              name: "secret_key",
            },
            { configured: true, hint: "pk_test_4242", name: "public_key" },
            {
              configured: true,
              hint: "whtok_••••••••WXYZ",
              name: "webhook_token",
            },
          ],
          provider: "examplepay",
          ready: true,
        }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByText("Removed when you save.")).toBeDefined();
    fireEvent.change(screen.getByLabelText("public_key"), {
      target: { value: "pk_test_9999" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(submit).toHaveBeenCalled();
    });
    const formData = submit.mock.calls[0]?.[1];
    expect(formData?.get("provider")).toBe("examplepay");
    expect(formData?.get("credential_secret_key_mode")).toBe("keep");
    expect(formData?.get("credential_public_key_mode")).toBe("replace");
    expect(formData?.get("credential_public_key")).toBe("pk_test_9999");
    expect(formData?.get("credential_webhook_token_mode")).toBe("clear");
  });

  it("offers no removal of a credential the provider requires", () => {
    render(
      <TenantPaymentSettingsForm
        providers={providers}
        canEdit
        tenantId="TENANT001"
        initialSettings={readySettings}
      />
    );

    expect(screen.getAllByRole("button", { name: "Change" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });

  it("shows only the hint and never the plaintext of a usable configuration", () => {
    render(
      <TenantPaymentSettingsForm
        providers={providers}
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
        providers={providers}
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
        providers={providers}
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
        providers={providers}
        canEdit={false}
        tenantId="TENANT001"
        initialSettings={readySettings}
      />
    );

    expect(isClosed(paymentsCheckbox())).toBe(true);
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
        providers={[]}
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
        providers={providers}
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
        providers={providers}
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
      fields: stripeFields("sk_test_••••••••NEW1", "whsec_••••••••WXYZ"),
    };
    action.current = vi.fn().mockResolvedValue({
      message: "The payment settings were saved.",
      ok: true,
    } satisfies TenantPaymentSettingsFormState);

    const { rerender } = render(
      <TenantPaymentSettingsForm
        providers={providers}
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
        providers={providers}
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
        providers={providers}
        canEdit
        tenantId="TENANT001"
        initialSettings={{
          ...incompleteSettings,
          fields: stripeFields("sk_test_••••••••KLMN", ""),
        }}
      />
    );

    for (const control of submittedControls()) {
      expect(isClosed(control)).toBe(false);
    }

    fireEvent.change(screen.getByLabelText(/Webhook signing secret/u), {
      target: { value: "whsec_new" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      for (const control of submittedControls()) {
        expect(isClosed(control)).toBe(true);
      }
    });
  });
});
