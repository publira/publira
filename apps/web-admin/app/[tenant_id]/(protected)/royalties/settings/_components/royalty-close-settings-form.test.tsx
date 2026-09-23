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

import type { RoyaltyCloseSettingsFormState } from "../../royalty-types";
import { RoyaltyCloseSettingsForm } from "./royalty-close-settings-form";

vi.mock("next/navigation", () => ({
  useParams: () => ({ tenant_id: "TENANT001" }),
}));

const noopAction = vi.fn();

const EnglishConsole = ({ children }: { children: ReactNode }) => (
  <AdminLocaleProvider locale="en" messages={sharedCatalog("en")}>
    {children}
  </AdminLocaleProvider>
);

const renderCard = async (ui: ReactNode) => {
  await act(() => {
    render(ui, { wrapper: EnglishConsole });
  });
  await screen.findByRole("button", { name: "Save the closing settings" });
};

const submitButton = () =>
  screen.getByRole<HTMLButtonElement>("button", {
    name: "Save the closing settings",
  });

const dayField = () => screen.queryByRole("combobox", { name: /Close day/u });

const hiddenValue = (name: string) =>
  document.querySelector<HTMLInputElement>(
    `input[type="hidden"][name="${name}"]`
  )?.value;

afterEach(() => {
  cleanup();
});

describe("RoyaltyCloseSettingsForm", () => {
  it("offers no day while months are closed by hand", async () => {
    await renderCard(
      <RoyaltyCloseSettingsForm
        action={noopAction}
        canEdit
        initialPolicy={{ automaticSince: "", closeMode: "manual" }}
      />
    );

    expect(
      screen
        .getByRole("radio", { name: /Close each month myself/u })
        .getAttribute("aria-checked")
    ).toBe("true");
    expect(dayField()).toBeNull();
    expect(hiddenValue("auto_close_day")).toBeUndefined();
  });

  it("asks for the day once automatic closing is chosen", async () => {
    await renderCard(
      <RoyaltyCloseSettingsForm
        action={noopAction}
        canEdit
        initialPolicy={{ automaticSince: "", closeMode: "manual" }}
      />
    );

    fireEvent.click(
      screen.getByRole("radio", { name: /Close automatically/u })
    );

    expect(
      await screen.findByRole("combobox", { name: /Close day/u })
    ).toBeDefined();
    expect(hiddenValue("close_mode")).toBe("automatic");
    expect(hiddenValue("auto_close_day")).toBe("");
  });

  it("starts from the saved day in automatic mode", async () => {
    await renderCard(
      <RoyaltyCloseSettingsForm
        action={noopAction}
        canEdit
        initialPolicy={{
          autoCloseDay: 5,
          automaticSince: "2026-08-15T00:00:00Z",
          closeMode: "automatic",
        }}
      />
    );

    expect(dayField()?.textContent).toContain("Day 5");
    expect(hiddenValue("auto_close_day")).toBe("5");
  });

  // Switching changes which months the batch closes, so each option says what
  // becomes of the months that are still open.
  it("explains what each mode does to the months still open", async () => {
    await renderCard(
      <RoyaltyCloseSettingsForm
        action={noopAction}
        canEdit
        initialPolicy={{ automaticSince: "", closeMode: "manual" }}
      />
    );

    expect(
      screen.getByText(/A month stays open until you do\./u)
    ).toBeDefined();
    expect(
      screen.getByText(
        /Months that ended before you switch to this stay open, and you close them under Royalties\./u
      )
    ).toBeDefined();
  });

  it("shows the refused day beside the day select", async () => {
    const refusingAction = vi.fn((): Promise<RoyaltyCloseSettingsFormState> =>
      Promise.resolve({
        fieldErrors: {
          autoCloseDay:
            "Choose the day of the following month on which to close.",
        },
        message: "Please check the highlighted fields.",
        ok: false,
      })
    );

    await renderCard(
      <RoyaltyCloseSettingsForm
        action={refusingAction}
        canEdit
        initialPolicy={{ automaticSince: "", closeMode: "manual" }}
      />
    );

    fireEvent.click(
      screen.getByRole("radio", { name: /Close automatically/u })
    );
    fireEvent.click(submitButton());

    expect(
      await screen.findByText(
        "Choose the day of the following month on which to close."
      )
    ).toBeDefined();
    expect(refusingAction).toHaveBeenCalledTimes(1);
  });

  it("stays read-only for someone who is not a tenant admin", async () => {
    await renderCard(
      <RoyaltyCloseSettingsForm
        action={noopAction}
        canEdit={false}
        initialPolicy={{ automaticSince: "", closeMode: "manual" }}
      />
    );

    for (const radio of screen.getAllByRole("radio")) {
      expect(radio.getAttribute("aria-disabled")).toBe("true");
    }
    expect(submitButton().disabled).toBe(true);
  });

  it("blocks editing and shows the reason when the read fails", async () => {
    await renderCard(
      <RoyaltyCloseSettingsForm
        action={noopAction}
        canEdit
        loadErrorMessage="Could not load royalties."
      />
    );

    expect(submitButton().disabled).toBe(true);
    await waitFor(() => {
      expect(screen.getByText("Could not load royalties.")).toBeDefined();
    });
  });
});
