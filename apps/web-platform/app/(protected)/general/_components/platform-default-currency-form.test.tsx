// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import en from "../../../../../../locales/en.json";
import { PlatformDefaultCurrencyForm } from "./platform-default-currency-form";

const messages = {
  "platform.settings.default_currency_description":
    "The currency a tenant sells in until it saves one of its own.",
  "platform.settings.default_currency_empty": "No matching currencies.",
  "platform.settings.default_currency_help": "Search by name or code.",
  "platform.settings.default_currency_label": "Default currency",
  "platform.settings.default_currency_locked":
    "A tenant that sells in this currency has a purchase.",
  "platform.settings.default_currency_reload": "Reload first, then change it.",
  "platform.settings.default_currency_save": "Save default currency",
  "platform.settings.default_currency_title": "Default currency",
} as const;

vi.mock("#components/message", () => ({
  Message: ({ message }: { message: keyof typeof messages }) =>
    messages[message],
}));

vi.mock("#lib/locale", () => ({
  getPlatformLocale: () => Promise.resolve("en"),
  loadPlatformMessages: () => Promise.resolve(en),
}));

afterEach(() => {
  cleanup();
});

const saveButton = () =>
  screen.getByRole<HTMLButtonElement>("button", {
    name: "Save default currency",
  });

const postedCurrency = (container: HTMLElement) =>
  container.querySelector<HTMLInputElement>('input[name="default_currency"]');

describe("PlatformDefaultCurrencyForm", () => {
  it("shows the saved default currency and lets it change", async () => {
    const { container } = render(
      await PlatformDefaultCurrencyForm({
        initialDefaultCurrency: "JPY",
        locked: false,
      })
    );

    const input = screen.getByRole<HTMLInputElement>("combobox", {
      name: "Default currency",
    });

    expect(input.value).toBe("Japanese Yen (JPY)");
    expect(input.disabled).toBe(false);
    expect(postedCurrency(container)?.value).toBe("JPY");
    expect(saveButton().disabled).toBe(false);
    expect(screen.getByText("Search by name or code.")).toBeDefined();
  });

  it("shows a locked currency read-only with the reason, and posts none", async () => {
    const { container } = render(
      await PlatformDefaultCurrencyForm({
        initialDefaultCurrency: "JPY",
        locked: true,
      })
    );

    const input = screen.getByRole<HTMLInputElement>("combobox", {
      name: "Default currency",
    });

    expect(input.value).toBe("Japanese Yen (JPY)");
    expect(input.disabled).toBe(true);
    expect(postedCurrency(container)).toBeNull();
    expect(saveButton().disabled).toBe(true);
    expect(
      screen.getByText("A tenant that sells in this currency has a purchase.")
    ).toBeDefined();
  });

  it("disables editing and shows the reason when loading fails", async () => {
    render(
      await PlatformDefaultCurrencyForm({
        loadErrorMessage: "Could not load the platform settings.",
        locked: false,
      })
    );

    expect(
      screen.getByRole<HTMLInputElement>("combobox", {
        name: "Default currency",
      }).disabled
    ).toBe(true);
    expect(saveButton().disabled).toBe(true);
    expect(
      screen.getByText(/Could not load the platform settings\./u)
    ).toBeDefined();
  });
});
