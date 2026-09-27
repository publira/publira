// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
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

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";

import type { TenantPurchaseSettingsFormState } from "../payment-types";
import { TenantPurchaseSettingsForm } from "./tenant-purchase-settings-form";

const { action } = vi.hoisted(() => ({
  action: {
    current: (): Promise<TenantPurchaseSettingsFormState> =>
      Promise.resolve(null),
  },
}));

vi.mock("../_lib/actions", () => ({
  updateTenantPurchaseSettingsAction: () => action.current(),
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

const storedSettings = {
  appStoreUrl: "https://apps.apple.com/app/id123",
  googlePlayUrl: "",
  purchaseAvailability: "app",
} as const;

const EnglishConsole = ({ children }: { children: ReactNode }) => (
  <AdminLocaleTestProvider locale="en">{children}</AdminLocaleTestProvider>
);

const renderCard = async (ui: ReactNode) => {
  await act(() => {
    render(ui, { wrapper: EnglishConsole });
  });
};

const submitButton = () =>
  screen.getByRole<HTMLButtonElement>("button", {
    name: "Save where episodes are sold",
  });

const posted = (name: string) =>
  document.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value;

afterEach(() => {
  cleanup();
  action.current = () => Promise.resolve(null);
});

describe("TenantPurchaseSettingsForm", () => {
  it("opens on the stored default and store addresses", async () => {
    await renderCard(
      <TenantPurchaseSettingsForm
        canEdit
        initialSettings={storedSettings}
        tenantId="TENANT001"
      />
    );

    expect(screen.getByRole("combobox", { name: "Sold on" }).textContent).toBe(
      "App only"
    );
    expect(posted("purchase_availability")).toBe("app");
    expect(
      screen.getByRole<HTMLInputElement>("textbox", {
        name: "App Store address",
      }).value
    ).toBe("https://apps.apple.com/app/id123");
    expect(
      screen.getByRole<HTMLInputElement>("textbox", {
        name: "Google Play address",
      }).value
    ).toBe("");
    expect(submitButton().disabled).toBe(false);
  });

  // The address a refused save names has to stay in the field, or the
  // operator would retype it next to the message that says it was wrong.
  it("keeps what was typed and names the refused address beside it", async () => {
    const refuse = vi.fn((): Promise<TenantPurchaseSettingsFormState> =>
      Promise.resolve({
        fieldErrors: {
          googlePlayUrl:
            "Enter the Google Play address as an https:// URL, or leave it empty.",
        },
        message: "Please check the information you entered.",
        ok: false,
      })
    );
    action.current = refuse;
    await renderCard(
      <TenantPurchaseSettingsForm
        canEdit
        initialSettings={storedSettings}
        tenantId="TENANT001"
      />
    );

    const googlePlay = screen.getByRole<HTMLInputElement>("textbox", {
      name: "Google Play address",
    });
    fireEvent.change(googlePlay, { target: { value: "play.google.com" } });
    await act(() => {
      fireEvent.click(submitButton());
    });

    await waitFor(() => {
      expect(
        screen.getByText(
          "Enter the Google Play address as an https:// URL, or leave it empty."
        )
      ).toBeDefined();
    });
    expect(refuse).toHaveBeenCalledOnce();
    expect(
      screen.getByRole<HTMLInputElement>("textbox", {
        name: "Google Play address",
      }).value
    ).toBe("play.google.com");
  });

  // A failed read leaves nothing to seed the fields with, and a save from that
  // state would write whatever they held over the stored default.
  it("keeps saving closed when the settings could not be read", async () => {
    await renderCard(
      <TenantPurchaseSettingsForm
        canEdit
        loadErrorMessage="Could not load where episodes are sold. Please try again later."
        tenantId="TENANT001"
      />
    );

    expect(
      screen.getByText(
        "Could not load where episodes are sold. Please try again later."
      )
    ).toBeDefined();
    expect(screen.queryByRole("combobox", { name: "Sold on" })).toBeNull();
    expect(submitButton().disabled).toBe(true);
  });

  it("leaves the settings read-only for an operator who is not an admin", async () => {
    await renderCard(
      <TenantPurchaseSettingsForm
        canEdit={false}
        initialSettings={storedSettings}
        tenantId="TENANT001"
      />
    );

    expect(
      screen
        .getByRole<HTMLInputElement>("textbox", {
          name: "App Store address",
        })
        .matches(":disabled")
    ).toBe(true);
    expect(submitButton().disabled).toBe(true);
  });
});
