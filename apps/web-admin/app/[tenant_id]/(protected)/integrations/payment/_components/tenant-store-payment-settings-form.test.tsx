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
import type { TenantStorePaymentSettings } from "#lib/store-payment-settings-shared";

import type { TenantStorePaymentSettingsFormState } from "../payment-types";
import { TenantStorePaymentSettingsForm } from "./tenant-store-payment-settings-form";

vi.mock("next/navigation", () => ({
  useParams: () => ({ tenant_id: "TENANT001" }),
}));

const noopAction = vi.fn();

const unsetSettings: TenantStorePaymentSettings = {
  appPurchaseRoute: "external_checkout",
  appStore: {
    bundleIdentifier: "",
    enabled: false,
    issuerId: "",
    keyId: "",
    privateKeyConfigured: false,
    privateKeyHint: "",
    ready: false,
  },
  googlePlay: {
    enabled: false,
    packageName: "com.example.reader",
    ready: false,
    serviceAccountEmail: "",
    serviceAccountKeyConfigured: false,
    serviceAccountKeyHint: "",
  },
};

const readySettings: TenantStorePaymentSettings = {
  appPurchaseRoute: "store",
  appStore: {
    bundleIdentifier: "com.example.reader",
    enabled: true,
    issuerId: "57246542-96fe-1a63-e053-0824d011072a",
    keyId: "2X9R4HXF34",
    privateKeyConfigured: true,
    privateKeyHint: "••••••••wIBAQQg",
    ready: true,
  },
  googlePlay: {
    enabled: false,
    packageName: "com.example.reader",
    ready: false,
    serviceAccountEmail: "publira@example-project.iam.gserviceaccount.com",
    serviceAccountKeyConfigured: true,
    serviceAccountKeyHint: "••••••••1f2e",
  },
};

const EnglishConsole = ({ children }: { children: ReactNode }) => (
  <AdminLocaleProvider locale="en" messages={sharedCatalog("en")}>
    {children}
  </AdminLocaleProvider>
);

const renderForm = async (ui: ReactNode) => {
  await act(() => {
    render(ui, { wrapper: EnglishConsole });
  });
};

const submitButton = () =>
  screen.getByRole<HTMLButtonElement>("button", {
    name: "Save the in-app purchase settings",
  });

const posted = (name: string) =>
  document.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value;

afterEach(() => {
  cleanup();
});

describe("TenantStorePaymentSettingsForm", () => {
  it("keeps the store route closed until a store is ready", async () => {
    await renderForm(
      <TenantStorePaymentSettingsForm
        action={noopAction}
        canEdit
        initialSettings={unsetSettings}
      />
    );

    const store = screen.getByRole("radio", { name: "In-app purchase" });
    expect(store.getAttribute("aria-disabled")).toBe("true");
    expect(
      screen.getByText(
        "Available once the App Store or Google Play below is ready.",
        { exact: false }
      )
    ).toBeDefined();
    expect(
      screen
        .getByRole("radio", { name: "Web checkout" })
        .getAttribute("aria-checked")
    ).toBe("true");
    expect(posted("app_purchase_route")).toBe("external_checkout");
  });

  it("shows the URL App Store Server Notifications are sent to", async () => {
    await renderForm(
      <TenantStorePaymentSettingsForm
        action={noopAction}
        canEdit
        initialSettings={readySettings}
        notificationUrl="https://shop.example.com/api/v1/webhook/payment/app-store"
      />
    );

    const url = screen.getByLabelText<HTMLInputElement>(
      "App Store Server Notifications URL"
    );
    expect(url.value).toBe(
      "https://shop.example.com/api/v1/webhook/payment/app-store"
    );
    expect(url.readOnly).toBe(true);
  });

  it("leaves the notification URL out while the tenant has no domain", async () => {
    await renderForm(
      <TenantStorePaymentSettingsForm
        action={noopAction}
        canEdit
        initialSettings={readySettings}
      />
    );

    expect(screen.queryByText("App Store Server Notifications URL")).toBeNull();
  });

  it("asks for a key as a file or pasted text where none is stored", async () => {
    await renderForm(
      <TenantStorePaymentSettingsForm
        action={noopAction}
        canEdit
        initialSettings={unsetSettings}
      />
    );

    expect(
      document.querySelector('input[type="file"][name="private_key_file"]')
    ).not.toBeNull();
    expect(
      screen
        .getAllByRole("textbox", { name: "Or paste the contents" })
        .map((textarea) => textarea.getAttribute("name"))
    ).toEqual(["private_key", "service_account_key"]);
    expect(posted("private_key_mode")).toBe("replace");
    expect(screen.getAllByText("Not set").length).toBeGreaterThan(0);
  });

  it("shows stored keys masked and the apps each store sells in", async () => {
    await renderForm(
      <TenantStorePaymentSettingsForm
        action={noopAction}
        canEdit
        initialSettings={readySettings}
      />
    );

    expect(
      screen.getByRole<HTMLInputElement>("textbox", {
        name: "Private key (.p8)",
      }).value
    ).toBe("••••••••wIBAQQg");
    expect(
      screen.getByRole<HTMLInputElement>("textbox", {
        name: "Service account key (JSON)",
      }).value
    ).toBe("••••••••1f2e");
    expect(
      screen.getByRole<HTMLInputElement>("textbox", { name: "Bundle ID" }).value
    ).toBe("com.example.reader");
    expect(
      screen.getByRole<HTMLInputElement>("textbox", {
        name: "Service account",
      }).value
    ).toBe("publira@example-project.iam.gserviceaccount.com");
    expect(posted("private_key_mode")).toBe("keep");
    expect(
      screen
        .getByRole("radio", { name: "In-app purchase" })
        .getAttribute("aria-checked")
    ).toBe("true");
    expect(screen.getByText("Ready")).toBeDefined();
  });

  it("posts a removal until the operator keeps the key again", async () => {
    await renderForm(
      <TenantStorePaymentSettingsForm
        action={noopAction}
        canEdit
        initialSettings={readySettings}
      />
    );

    const [removeAppStoreKey] = screen.getAllByRole("button", {
      name: "Remove",
    });
    fireEvent.click(removeAppStoreKey);
    expect(posted("private_key_mode")).toBe("clear");
    expect(
      screen.getByText("The stored key is removed when you save.")
    ).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Keep the key" }));
    expect(posted("private_key_mode")).toBe("keep");
  });

  it("keeps the IDs typed and names the refused field beside them", async () => {
    const action = vi.fn((): Promise<TenantStorePaymentSettingsFormState> =>
      Promise.resolve({
        fieldErrors: {
          keyId:
            "Enter the key ID as App Store Connect shows it, ten capital letters and digits.",
        },
        message: "Please check the information you entered.",
        ok: false,
      })
    );
    await renderForm(
      <TenantStorePaymentSettingsForm
        action={action}
        canEdit
        initialSettings={readySettings}
      />
    );

    fireEvent.change(screen.getByRole("textbox", { name: /Key ID/u }), {
      target: { value: "bad" },
    });
    await act(() => {
      fireEvent.click(submitButton());
    });

    await waitFor(() => {
      expect(
        screen.getByText(
          "Enter the key ID as App Store Connect shows it, ten capital letters and digits."
        )
      ).toBeDefined();
    });
    expect(
      screen.getByRole<HTMLInputElement>("textbox", { name: /Key ID/u }).value
    ).toBe("bad");
  });

  it("keeps saving closed when the settings could not be read", async () => {
    await renderForm(
      <TenantStorePaymentSettingsForm
        action={noopAction}
        canEdit
        loadErrorMessage="Could not load the in-app purchase settings. Please try again later."
      />
    );

    expect(
      screen.getByText(
        "Could not load the in-app purchase settings. Please try again later."
      )
    ).toBeDefined();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(submitButton().disabled).toBe(true);
  });

  it("leaves the settings read-only for an operator who is not an admin", async () => {
    await renderForm(
      <TenantStorePaymentSettingsForm
        action={noopAction}
        canEdit={false}
        initialSettings={readySettings}
      />
    );

    expect(
      screen.getByRole<HTMLInputElement>("textbox", { name: /Issuer ID/u })
        .disabled
    ).toBe(true);
    for (const replace of screen.getAllByRole<HTMLButtonElement>("button", {
      name: "Replace",
    })) {
      expect(replace.disabled).toBe(true);
    }
    expect(submitButton().disabled).toBe(true);
  });
});
