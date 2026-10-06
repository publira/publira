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

import type { RoyaltyCloseSettingsFormState } from "../../royalty-types";
import { RoyaltyCloseSettingsForm } from "./royalty-close-settings-form";

const { save } = vi.hoisted(() => ({
  save: {
    current: vi.fn(
      () => Promise.withResolvers<RoyaltyCloseSettingsFormState>().promise
    ),
  },
}));

vi.mock("../_lib/actions", () => ({
  updateRoyaltyCloseSettingsAction: () => save.current(),
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

const EnglishConsole = ({ children }: { children: ReactNode }) => (
  <AdminLocaleTestProvider locale="en">{children}</AdminLocaleTestProvider>
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
  save.current = vi.fn(
    () => Promise.withResolvers<RoyaltyCloseSettingsFormState>().promise
  );
});

describe("RoyaltyCloseSettingsForm", () => {
  it("offers no day while months are closed by hand", async () => {
    await renderCard(
      <RoyaltyCloseSettingsForm
        canEdit
        initialPolicy={{ automaticSince: "", closeMode: "manual" }}
        tenantId="TENANT001"
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
        canEdit
        initialPolicy={{ automaticSince: "", closeMode: "manual" }}
        tenantId="TENANT001"
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
        canEdit
        initialPolicy={{
          autoCloseDay: 5,
          automaticSince: "2026-08-15T00:00:00Z",
          closeMode: "automatic",
        }}
        tenantId="TENANT001"
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
        canEdit
        initialPolicy={{ automaticSince: "", closeMode: "manual" }}
        tenantId="TENANT001"
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
    save.current = vi.fn((): Promise<RoyaltyCloseSettingsFormState> =>
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
        canEdit
        initialPolicy={{ automaticSince: "", closeMode: "manual" }}
        tenantId="TENANT001"
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
    expect(save.current).toHaveBeenCalledTimes(1);
  });

  it("stays read-only for someone who is not a tenant admin", async () => {
    await renderCard(
      <RoyaltyCloseSettingsForm
        canEdit={false}
        initialPolicy={{ automaticSince: "", closeMode: "manual" }}
        tenantId="TENANT001"
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
        canEdit
        loadErrorMessage="Could not load royalties."
        tenantId="TENANT001"
      />
    );

    expect(submitButton().disabled).toBe(true);
    await waitFor(() => {
      expect(screen.getByText("Could not load royalties.")).toBeDefined();
    });
  });
});
