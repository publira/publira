// @vitest-environment jsdom

import { bindMessages, getLocaleLabel } from "@publira/i18n";
import type { Locale, MessageKey, MessageValues } from "@publira/i18n";
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

import type { TenantLocalesActionState } from "../settings-types";
import { TenantLocalesForm } from "./tenant-locales-form";

const { save } = vi.hoisted(() => ({
  save: {
    current: Promise.withResolvers<TenantLocalesActionState>(),
    formData: undefined as FormData | undefined,
  },
}));

vi.mock("../_lib/actions", () => ({
  updateTenantLocalesAction: (_state: unknown, formData: FormData) => {
    save.formData = formData;

    return save.current.promise;
  },
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

const render = (ui: ReactNode) =>
  renderBase(ui, {
    wrapper: ({ children }) => (
      <AdminLocaleTestProvider locale="en">{children}</AdminLocaleTestProvider>
    ),
  });

afterEach(() => {
  cleanup();
  // A submission left in flight would hold back the next test's transitions.
  save.current.resolve(null);
  save.current = Promise.withResolvers<TenantLocalesActionState>();
  save.formData = undefined;
});

/** A language's box, found by the autonym it is labelled with. */
const languageBox = (code: Locale) =>
  screen.getByRole<HTMLElement>("checkbox", { name: getLocaleLabel(code) });

const isChecked = (code: Locale) =>
  languageBox(code).getAttribute("aria-checked") === "true";

const isDisabled = (code: Locale) =>
  languageBox(code).dataset.disabled !== undefined;

const saveButton = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: "Save the languages" });

const submittedLocales = async () => {
  fireEvent.click(saveButton());
  await waitFor(() => {
    expect(save.formData).toBeDefined();
  });

  return {
    defaultLocale: save.formData?.get("default_locale"),
    supportedLocales: save.formData?.getAll("supported_locales"),
  };
};

describe("TenantLocalesForm", () => {
  it("shows the saved default and ticks the languages offered", async () => {
    render(
      <TenantLocalesForm
        canEdit
        initialLocales={{ defaultLocale: "en", supportedLocales: ["ja", "en"] }}
        tenantId="TENANT001"
      />
    );

    const trigger = await screen.findByLabelText("Default language");

    expect(trigger.textContent).toContain("English");
    expect(isChecked("ja")).toBe(true);
    expect(isChecked("en")).toBe(true);
    expect(isChecked("ko")).toBe(false);
  });

  it("keeps the default language ticked and closed", async () => {
    render(
      <TenantLocalesForm
        canEdit
        initialLocales={{ defaultLocale: "en", supportedLocales: ["ja", "en"] }}
        tenantId="TENANT001"
      />
    );

    await screen.findByLabelText("Default language");

    expect(isDisabled("en")).toBe(true);
    expect(isDisabled("ja")).toBe(false);

    fireEvent.click(languageBox("en"));

    expect(isChecked("en")).toBe(true);
  });

  it("ticks and closes a language when it becomes the default", async () => {
    render(
      <TenantLocalesForm
        canEdit
        initialLocales={{ defaultLocale: "en", supportedLocales: ["en"] }}
        tenantId="TENANT001"
      />
    );

    const trigger = await screen.findByLabelText("Default language");
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(
      await screen.findByRole("option", { name: getLocaleLabel("ko") }),
      { key: "Enter" }
    );

    await waitFor(() => {
      expect(isChecked("ko")).toBe(true);
    });
    expect(isDisabled("ko")).toBe(true);
    // The previous default stays offered, and can now be switched off.
    expect(isChecked("en")).toBe(true);
    expect(isDisabled("en")).toBe(false);
  });

  it("sends the default among the languages offered", async () => {
    render(
      <TenantLocalesForm
        canEdit
        initialLocales={{ defaultLocale: "en", supportedLocales: ["ja", "en"] }}
        tenantId="TENANT001"
      />
    );

    await screen.findByLabelText("Default language");
    fireEvent.click(languageBox("ja"));

    await expect(submittedLocales()).resolves.toEqual({
      defaultLocale: "en",
      supportedLocales: ["en"],
    });
    expect(save.formData?.get("tenant_id")).toBe("TENANT001");
  });

  it("stays read-only for someone who is not a tenant admin", async () => {
    render(
      <TenantLocalesForm
        canEdit={false}
        initialLocales={{ defaultLocale: "ja", supportedLocales: ["ja", "en"] }}
        tenantId="TENANT001"
      />
    );

    expect(await screen.findByLabelText("Default language")).toHaveProperty(
      "disabled",
      true
    );
    expect(isDisabled("en")).toBe(true);
    expect(saveButton().disabled).toBe(true);
    expect(
      screen.getByText(
        "Only a tenant administrator can change this setting. You have read-only access."
      )
    ).toBeDefined();
  });

  it("blocks editing and shows the reason when the fetch fails", async () => {
    render(
      <TenantLocalesForm
        canEdit
        loadErrorMessage="Could not load the languages."
        tenantId="TENANT001"
      />
    );

    expect(await screen.findByLabelText("Default language")).toHaveProperty(
      "disabled",
      true
    );
    expect(isDisabled("en")).toBe(true);
    expect(saveButton().disabled).toBe(true);
    expect(screen.getByText(/Could not load the languages./u)).toBeDefined();
    expect(
      screen.getByText(/Saving now would overwrite the stored setting/u)
    ).toBeDefined();
  });

  // The Action carries the languages chosen when the form was submitted, so a
  // change made while it is in flight would sit under the success message
  // unsaved.
  it("closes the fields while the save is in flight", async () => {
    render(
      <TenantLocalesForm
        canEdit
        initialLocales={{ defaultLocale: "en", supportedLocales: ["ja", "en"] }}
        tenantId="TENANT001"
      />
    );

    const trigger = await screen.findByLabelText("Default language");

    fireEvent.click(saveButton());

    await waitFor(() => {
      expect(trigger).toHaveProperty("disabled", true);
    });
    expect(isDisabled("ja")).toBe(true);
  });
});
