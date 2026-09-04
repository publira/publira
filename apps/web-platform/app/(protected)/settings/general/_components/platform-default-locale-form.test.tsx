// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import en from "../../../../../../../locales/en.json";
import { PlatformDefaultLocaleForm } from "./platform-default-locale-form";

const messages = {
  "platform.settings.default_locale_description":
    "The language a newly created tenant starts in.",
  "platform.settings.default_locale_help":
    "You can choose Japanese or English.",
  "platform.settings.default_locale_label": "Default language",
  "platform.settings.default_locale_reload":
    "Saving now would overwrite the current setting, so reload before changing it.",
  "platform.settings.default_locale_save": "Save default language",
  "platform.settings.default_locale_title": "Default language",
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

describe("PlatformDefaultLocaleForm", () => {
  it("shows the saved default language as selected", async () => {
    render(
      await PlatformDefaultLocaleForm({
        initialDefaultLocale: "en",
      })
    );

    const trigger = screen.getByLabelText("Default language");

    expect(trigger.textContent).toContain("English");
    expect(trigger).toHaveProperty("disabled", false);
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Save default language",
      }).disabled
    ).toBe(false);
  });

  it("disables editing and shows the reason when loading fails", async () => {
    render(
      await PlatformDefaultLocaleForm({
        initialDefaultLocale: "ja",
        loadErrorMessage: "Could not load the platform settings.",
      })
    );

    expect(screen.getByLabelText("Default language")).toHaveProperty(
      "disabled",
      true
    );
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Save default language",
      }).disabled
    ).toBe(true);
    expect(
      screen.getByText(/Could not load the platform settings\./u)
    ).toBeDefined();
    expect(
      screen.getByText(/Saving now would overwrite the current setting/u)
    ).toBeDefined();
  });
});
