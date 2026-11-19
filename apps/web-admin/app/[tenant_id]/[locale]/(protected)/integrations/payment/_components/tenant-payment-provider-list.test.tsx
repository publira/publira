// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import * as Toast from "@publira/ui-components/toast";
import {
  cleanup,
  fireEvent,
  render as renderBase,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";
import type {
  PaymentProvider,
  TenantPaymentProviderSettings,
  TenantPaymentProviders,
} from "#lib/payment-settings-shared";

import type {
  TenantPaymentProviderRemoveFormState,
  TenantPaymentSettingsFormState,
} from "../payment-types";
import { TenantPaymentProviderList } from "./tenant-payment-provider-list";

type SaveAction = (
  state: TenantPaymentSettingsFormState,
  formData: FormData
) => Promise<TenantPaymentSettingsFormState>;

type RemoveAction = (
  state: TenantPaymentProviderRemoveFormState,
  formData: FormData
) => Promise<TenantPaymentProviderRemoveFormState>;

const { actions } = vi.hoisted(() => ({
  actions: {
    add: vi.fn<SaveAction>(),
    remove: vi.fn<RemoveAction>(),
    save: vi.fn<SaveAction>(),
  },
}));

vi.mock("../_lib/actions", () => ({
  addTenantPaymentProviderAction: (
    state: TenantPaymentSettingsFormState,
    formData: FormData
  ) => actions.add(state, formData),
  removeTenantPaymentProviderAction: (
    state: TenantPaymentProviderRemoveFormState,
    formData: FormData
  ) => actions.remove(state, formData),
  saveTenantPaymentProviderAction: (
    state: TenantPaymentSettingsFormState,
    formData: FormData
  ) => actions.save(state, formData),
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
  currencies: ["JPY", "USD"],
  displayName: "Stripe",
  fields: [
    { name: "secret_key", public: false, required: true, secret: true },
    { name: "webhook_secret", public: false, required: true, secret: true },
  ],
  id: "stripe",
  subscriptions: true,
  webhookPath: "/api/v1/webhook/payment/stripe",
};

const payjp: PaymentProvider = {
  currencies: ["JPY"],
  displayName: "PAY.JP",
  fields: [
    { name: "secret_key", public: false, required: true, secret: true },
    { name: "webhook_token", public: false, required: true, secret: true },
  ],
  id: "payjp",
  subscriptions: false,
  webhookPath: "/api/v1/webhook/payment/payjp",
};

// A second provider that takes recurring payments, which only the first ready
// one of sells the plans.
const examplePay: PaymentProvider = {
  currencies: ["JPY", "USD"],
  displayName: "Example Pay",
  fields: [{ name: "secret_key", public: false, required: true, secret: true }],
  id: "examplepay",
  subscriptions: true,
  webhookPath: "/api/v1/webhook/payment/examplepay",
};

const registered = [payjp, stripe];

const readyStripe: TenantPaymentProviderSettings = {
  enabled: true,
  fields: [
    { configured: true, hint: "sk_test_••••••••KLMN", name: "secret_key" },
    { configured: true, hint: "whsec_••••••••WXYZ", name: "webhook_secret" },
  ],
  provider: "stripe",
  ready: true,
  retired: false,
};

const disabledPayjp: TenantPaymentProviderSettings = {
  enabled: false,
  fields: [
    { configured: true, hint: "sk_test_••••••••ABCD", name: "secret_key" },
    { configured: true, hint: "whook_••••••••EFGH", name: "webhook_token" },
  ],
  provider: "payjp",
  ready: false,
  retired: false,
};

const holding = (
  providers: TenantPaymentProviderSettings[],
  overrides: Partial<TenantPaymentProviders> = {}
): TenantPaymentProviders => ({
  currency: "JPY",
  currencyLocked: false,
  providers,
  ...overrides,
});

const render = (ui: ReactNode) =>
  renderBase(ui, {
    wrapper: ({ children }) => (
      <AdminLocaleTestProvider locale="en">
        <Toast.Provider>{children}</Toast.Provider>
      </AdminLocaleTestProvider>
    ),
  });

/** The card of the provider the tenant holds under `name`. */
const card = (name: string) => screen.getByRole("region", { name });

const addForm = () => screen.getByRole("region", { name: "Add a provider" });

afterEach(() => {
  cleanup();
  actions.add.mockReset();
  actions.remove.mockReset();
  actions.save.mockReset();
});

describe("TenantPaymentProviderList", () => {
  it("says no provider is set and offers every registered one to add", async () => {
    actions.add.mockResolvedValue({ message: "PAY.JP was added.", ok: true });

    render(
      <TenantPaymentProviderList
        canEdit
        held={holding([])}
        locale="en"
        providers={registered}
        tenantId="TENANT001"
        webhookOrigin="https://comics.example"
      />
    );

    expect(screen.getByText("Not set")).toBeDefined();
    expect(
      screen.getByText(
        "No payment provider has been added yet, so readers cannot buy paid episodes."
      )
    ).toBeDefined();

    const form = addForm();
    expect(
      within(form).getByRole("combobox", { name: "Payment provider" })
        .textContent
    ).toContain("PAY.JP");
    expect(
      within(form).getByDisplayValue(
        "https://comics.example/api/v1/webhook/payment/payjp"
      )
    ).toBeDefined();

    fireEvent.click(
      within(form).getByRole("checkbox", { name: "Enable payments" })
    );
    fireEvent.change(within(form).getByLabelText(/^Secret key/u), {
      target: { value: "sk_test_new" },
    });
    fireEvent.change(within(form).getByLabelText(/^Webhook token/u), {
      target: { value: "whook_new" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Add provider" }));

    await waitFor(() => {
      expect(actions.add).toHaveBeenCalled();
    });
    const formData = actions.add.mock.calls[0]?.[1];
    expect(formData?.get("tenant_id")).toBe("TENANT001");
    expect(formData?.get("provider")).toBe("payjp");
    expect(formData?.get("enabled")).toBe("on");
    expect(formData?.get("credential_secret_key")).toBe("sk_test_new");
    expect(formData?.get("credential_webhook_token")).toBe("whook_new");
    expect(await screen.findByText("PAY.JP was added.")).toBeDefined();
  });

  it("shows a card per provider the tenant holds, and adds only the others, without deleting anything", () => {
    render(
      <TenantPaymentProviderList
        canEdit
        held={holding([readyStripe])}
        locale="en"
        providers={registered}
        tenantId="TENANT001"
        webhookOrigin="https://comics.example"
      />
    );

    const stripeCard = card("Stripe");
    expect(within(stripeCard).getByText("Ready")).toBeDefined();
    expect(
      within(stripeCard).getByText("Readers can pay through Stripe.")
    ).toBeDefined();
    expect(
      within(stripeCard).getByDisplayValue("sk_test_••••••••KLMN")
    ).toBeDefined();
    expect(
      within(stripeCard).getByDisplayValue(
        "https://comics.example/api/v1/webhook/payment/stripe"
      )
    ).toBeDefined();

    const form = addForm();
    expect(
      within(form).getByRole("combobox", { name: "Payment provider" })
        .textContent
    ).toContain("PAY.JP");
    expect(within(form).queryByDisplayValue("sk_test_••••••••KLMN")).toBeNull();
    expect(document.body.textContent).not.toContain("deletes the credentials");
  });

  it("offers no addition once the tenant holds every provider", () => {
    render(
      <TenantPaymentProviderList
        canEdit
        held={holding([readyStripe, disabledPayjp])}
        locale="en"
        providers={registered}
        tenantId="TENANT001"
      />
    );

    expect(within(card("PAY.JP")).getByText("Disabled")).toBeDefined();
    expect(screen.queryByRole("region", { name: "Add a provider" })).toBeNull();
  });

  it("names what each provider sells, plans only through the one that takes recurring payments", () => {
    render(
      <TenantPaymentProviderList
        canEdit
        held={holding([readyStripe, disabledPayjp])}
        locale="en"
        providers={registered}
        tenantId="TENANT001"
      />
    );

    expect(
      within(card("Stripe")).getByText(
        "Sells episodes, volumes, subscription plans, coins, and tips."
      )
    ).toBeDefined();
    expect(
      within(card("PAY.JP")).getByText(
        "Sells episodes, volumes, coins, and tips. It takes no recurring payments, so it sells no subscription plans."
      )
    ).toBeDefined();
  });

  it("names the provider the plans go through on a second one that takes recurring payments", () => {
    render(
      <TenantPaymentProviderList
        canEdit
        held={holding([
          readyStripe,
          {
            enabled: true,
            fields: [
              { configured: true, hint: "ex_••••1234", name: "secret_key" },
            ],
            provider: "examplepay",
            ready: true,
            retired: false,
          },
        ])}
        locale="en"
        providers={[...registered, examplePay]}
        tenantId="TENANT001"
      />
    );

    expect(
      within(card("Example Pay")).getByText(
        "Sells episodes, volumes, coins, and tips. Subscription plans are sold through Stripe, the first ready provider that takes recurring payments."
      )
    ).toBeDefined();
  });

  it("offers only the currencies every provider the tenant sells through charges in", () => {
    render(
      <TenantPaymentProviderList
        canEdit
        held={holding([readyStripe, disabledPayjp])}
        locale="en"
        providers={registered}
        tenantId="TENANT001"
      />
    );

    fireEvent.click(
      within(card("Stripe")).getByRole("combobox", { name: "Currency" })
    );
    expect(
      screen.getAllByRole("option").map((option) => option.textContent)
    ).toEqual(["Japanese Yen (JPY)"]);
  });

  it("says why a provider cannot sell beside the others in the tenant's currency", () => {
    render(
      <TenantPaymentProviderList
        canEdit
        held={holding([readyStripe], { currency: "USD", currencyLocked: true })}
        locale="en"
        providers={registered}
        tenantId="TENANT001"
      />
    );

    expect(
      within(addForm()).getByText(
        "PAY.JP does not charge in USD, which this tenant sells in, so it cannot sell beside the others."
      )
    ).toBeDefined();
  });

  it("saves a card's provider alone", async () => {
    actions.save.mockResolvedValue({
      message: "The Stripe settings were saved.",
      ok: true,
    });

    render(
      <TenantPaymentProviderList
        canEdit
        held={holding([readyStripe, disabledPayjp])}
        locale="en"
        providers={registered}
        tenantId="TENANT001"
      />
    );

    fireEvent.click(
      within(card("Stripe")).getByRole("button", { name: "Save" })
    );

    await waitFor(() => {
      expect(actions.save).toHaveBeenCalled();
    });
    const formData = actions.save.mock.calls[0]?.[1];
    expect(formData?.get("provider")).toBe("stripe");
    expect(formData?.get("credential_secret_key_mode")).toBe("keep");
    expect(formData?.get("credential_webhook_token_mode")).toBeNull();
    expect(
      await within(card("Stripe")).findByText("The Stripe settings were saved.")
    ).toBeDefined();
  });

  it("removes a provider once it is confirmed, posting none of its credentials", async () => {
    actions.remove.mockResolvedValue({
      message:
        "PAY.JP was removed. Its credentials are kept for what it already took.",
      ok: true,
    });

    render(
      <TenantPaymentProviderList
        canEdit
        held={holding([readyStripe, disabledPayjp])}
        locale="en"
        providers={registered}
        tenantId="TENANT001"
      />
    );

    fireEvent.click(
      within(card("PAY.JP")).getByRole("button", { name: "Remove" })
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Remove PAY.JP?")).toBeDefined();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(actions.remove).toHaveBeenCalled();
    });
    const formData = actions.remove.mock.calls[0]?.[1];
    expect(formData?.get("tenant_id")).toBe("TENANT001");
    expect(formData?.get("provider")).toBe("payjp");
    expect(formData?.get("retired")).toBeNull();
    expect(formData?.get("credential_secret_key_mode")).toBeNull();
    expect(
      await screen.findByText(
        "PAY.JP was removed. Its credentials are kept for what it already took."
      )
    ).toBeDefined();
  });

  it("shows a removed provider as removed, and offers to add it back or delete it", async () => {
    actions.remove.mockResolvedValue({
      message: "PAY.JP and its credentials were deleted.",
      ok: true,
    });

    render(
      <TenantPaymentProviderList
        canEdit
        held={holding([readyStripe, { ...disabledPayjp, retired: true }])}
        locale="en"
        providers={registered}
        tenantId="TENANT001"
      />
    );

    const payjpCard = card("PAY.JP");
    expect(within(payjpCard).getByText("Removed")).toBeDefined();
    expect(within(payjpCard).queryByText(/^Sells /u)).toBeNull();
    expect(
      within(payjpCard).getByRole("button", { name: "Add back" })
    ).toBeDefined();

    fireEvent.click(within(payjpCard).getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(actions.remove).toHaveBeenCalled();
    });
    expect(actions.remove.mock.calls[0]?.[1].get("retired")).toBe("1");
  });

  it("stays read-only for someone who is not a tenant admin", () => {
    render(
      <TenantPaymentProviderList
        canEdit={false}
        held={holding([readyStripe])}
        locale="en"
        providers={registered}
        tenantId="TENANT001"
      />
    );

    expect(
      screen.getByText(
        "Only a tenant administrator can change this setting. You have read-only access."
      )
    ).toBeDefined();
    expect(
      within(card("Stripe")).queryByRole("button", { name: "Remove" })
    ).toBeNull();
    expect(
      within(card("Stripe")).getByRole("button", { name: "Save" })
    ).toHaveProperty("disabled", true);
  });

  it("shows why the providers could not be read instead of a form", () => {
    render(
      <TenantPaymentProviderList
        canEdit
        held={holding([])}
        loadErrorMessage="Could not load the payment settings. Please try again later."
        locale="en"
        providers={registered}
        tenantId="TENANT001"
      />
    );

    expect(
      screen.getByText(
        "Could not load the payment settings. Please try again later."
      )
    ).toBeDefined();
    expect(screen.queryByRole("region", { name: "Add a provider" })).toBeNull();
  });
});
