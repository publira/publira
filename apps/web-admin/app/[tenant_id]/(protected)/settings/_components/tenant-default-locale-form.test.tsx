// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TenantDefaultLocaleActionState } from "../settings-types";
import { TenantDefaultLocaleForm } from "./tenant-default-locale-form";

const { save } = vi.hoisted(() => ({
  save: {
    current: Promise.withResolvers<TenantDefaultLocaleActionState>(),
    formData: undefined as FormData | undefined,
  },
}));

vi.mock("../_lib/actions", () => ({
  updateTenantDefaultLocaleAction: (_state: unknown, formData: FormData) => {
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

afterEach(() => {
  cleanup();
  // A submission left in flight would hold back the next test's transitions.
  save.current.resolve(null);
  save.current = Promise.withResolvers<TenantDefaultLocaleActionState>();
  save.formData = undefined;
});

describe("TenantDefaultLocaleForm", () => {
  it("shows the saved default locale as the selected one", () => {
    render(
      <TenantDefaultLocaleForm
        tenantId="TENANT001"
        canEdit
        initialDefaultLocale="en"
      />
    );

    const trigger = screen.getByLabelText("Default language");

    expect(trigger.textContent).toContain("English");
    expect(trigger).toHaveProperty("disabled", false);
  });

  it("stays read-only for someone who is not a tenant admin", () => {
    render(
      <TenantDefaultLocaleForm
        tenantId="TENANT001"
        canEdit={false}
        initialDefaultLocale="ja"
      />
    );

    expect(screen.getByLabelText("Default language")).toHaveProperty(
      "disabled",
      true
    );
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Save the default language",
      }).disabled
    ).toBe(true);
    expect(
      screen.getByText(
        "Only a tenant administrator can change this setting. You have read-only access."
      )
    ).toBeDefined();
  });

  it("blocks editing and shows the reason when the fetch fails", () => {
    render(
      <TenantDefaultLocaleForm
        tenantId="TENANT001"
        canEdit
        initialDefaultLocale="ja"
        loadErrorMessage="Could not load the default language."
      />
    );

    expect(screen.getByLabelText("Default language")).toHaveProperty(
      "disabled",
      true
    );
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Save the default language",
      }).disabled
    ).toBe(true);
    expect(
      screen.getByText(/Could not load the default language./u)
    ).toBeDefined();
    expect(
      screen.getByText(/Saving now would overwrite the stored setting/u)
    ).toBeDefined();
  });

  // The Action carries the locale picked when the form was submitted, so a
  // pick made while it is in flight would sit under the success message
  // unsaved.
  it("closes the picker while the save is in flight", async () => {
    render(
      <TenantDefaultLocaleForm
        tenantId="TENANT001"
        canEdit
        initialDefaultLocale="en"
      />
    );

    const trigger = screen.getByLabelText("Default language");

    expect(trigger).toHaveProperty("disabled", false);

    fireEvent.click(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Save the default language",
      })
    );

    await waitFor(() => {
      expect(trigger).toHaveProperty("disabled", true);
    });
  });

  it("posts the saved default locale", async () => {
    render(
      <TenantDefaultLocaleForm
        tenantId="TENANT001"
        canEdit
        initialDefaultLocale="en"
      />
    );

    fireEvent.click(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Save the default language",
      })
    );

    await waitFor(() => {
      expect(save.formData?.get("default_locale")).toBe("en");
    });
    expect(save.formData?.get("tenant_id")).toBe("TENANT001");
  });
});
