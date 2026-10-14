// @vitest-environment jsdom

import { getLocaleLabel } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { PlatformMessagesContextProvider } from "#components/platform-messages-context";
import { loadPlatformClientMessages } from "#lib/messages";

import { TenantLocalesPicker } from "./tenant-locales-picker";

const messages = loadPlatformClientMessages("en");

afterEach(() => {
  cleanup();
});

const renderPicker = async (initialDefaultLocale: Locale) => {
  let form: HTMLFormElement | undefined;
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <PlatformMessagesContextProvider messages={messages}>
          <form
            aria-label="Create tenant"
            ref={(element) => {
              form = element ?? undefined;
            }}
          >
            <TenantLocalesPicker initialDefaultLocale={initialDefaultLocale} />
          </form>
        </PlatformMessagesContextProvider>
      </Suspense>
    );
    await messages;
  });
  if (!form) {
    throw new Error("The picker did not render.");
  }
  return form;
};

/** A language's box, found by the autonym it is labelled with. */
const languageBox = (code: Locale) =>
  screen.getByRole<HTMLElement>("checkbox", { name: getLocaleLabel(code) });

const isChecked = (code: Locale) =>
  languageBox(code).getAttribute("aria-checked") === "true";

const isDisabled = (code: Locale) =>
  languageBox(code).dataset.disabled !== undefined;

describe("TenantLocalesPicker", () => {
  it("offers the default language alone, and keeps it ticked", async () => {
    const form = await renderPicker("ja");

    expect(isChecked("ja")).toBe(true);
    expect(isDisabled("ja")).toBe(true);
    expect(isChecked("en")).toBe(false);
    expect(new FormData(form).getAll("tenant_supported_locales")).toEqual([
      "ja",
    ]);
  });

  it("ticks and closes a language when it becomes the default", async () => {
    const form = await renderPicker("ja");

    const trigger = screen.getByRole("combobox", {
      name: /^Default language/u,
    });
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(
      await screen.findByRole("option", { name: getLocaleLabel("en") }),
      { key: "Enter" }
    );

    await waitFor(() => {
      expect(isChecked("en")).toBe(true);
    });
    expect(isDisabled("en")).toBe(true);
    expect(isChecked("ja")).toBe(true);
    expect(isDisabled("ja")).toBe(false);
    expect(new FormData(form).get("tenant_default_locale")).toBe("en");
    expect(
      new FormData(form).getAll("tenant_supported_locales").toSorted()
    ).toEqual(["en", "ja"]);
  });
});
