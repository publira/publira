// @vitest-environment jsdom

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

vi.mock("next/navigation", () => ({
  useParams: () => ({ tenant_id: "TENANT001" }),
}));

const noopAction = vi.fn();

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
});

describe("TenantPurchaseSettingsForm", () => {
  it("opens on the stored default and store addresses", async () => {
    await renderCard(
      <TenantPurchaseSettingsForm
        action={noopAction}
        canEdit
        initialSettings={storedSettings}
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

  // The address a refused save names has to stay in the field: React resets
  // an uncontrolled field once the Action settles, which would leave the
  // operator retyping it next to the message that says it was wrong.
  it("keeps what was typed and names the refused address beside it", async () => {
    const action = vi.fn((): Promise<TenantPurchaseSettingsFormState> =>
      Promise.resolve({
        fieldErrors: {
          googlePlayUrl:
            "Enter the Google Play address as an https:// URL, or leave it empty.",
        },
        message: "Please check the information you entered.",
        ok: false,
      })
    );
    await renderCard(
      <TenantPurchaseSettingsForm
        action={action}
        canEdit
        initialSettings={storedSettings}
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
    expect(action).toHaveBeenCalledOnce();
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
        action={noopAction}
        canEdit
        loadErrorMessage="Could not load where episodes are sold. Please try again later."
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
        action={noopAction}
        canEdit={false}
        initialSettings={storedSettings}
      />
    );

    expect(
      screen.getByRole<HTMLInputElement>("textbox", {
        name: "App Store address",
      }).disabled
    ).toBe(true);
    expect(submitButton().disabled).toBe(true);
  });
});
