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
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TenantTaxSettings } from "#lib/tenant-tax-settings";

import type { TenantTaxSettingsActionState } from "../settings-types";
import { TenantTaxSettingsForm } from "./tenant-tax-settings-form";

/** The answer the mocked Action gives, and the form it was submitted. */
interface PendingSubmission {
  current: PromiseWithResolvers<TenantTaxSettingsActionState>;
  formData?: FormData;
}

const { save } = vi.hoisted(() => {
  const submission: PendingSubmission = {
    current: Promise.withResolvers<TenantTaxSettingsActionState>(),
  };

  return { save: submission };
});

vi.mock("../_lib/actions", () => ({
  updateTenantTaxSettingsAction: (
    _state: TenantTaxSettingsActionState,
    formData: FormData
  ) => {
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

const SUBMIT = "Save the tax and invoice settings";

const SAVED: TenantTaxSettings = {
  invoiceLegalName: "Example Publishing Inc.",
  invoiceRegistrationNumber: "T1234567890123",
  taxRateAppliesFrom: "2026-10-31T15:00:00Z",
  taxRateBps: 1000,
  withholdingRateBps: 1021,
};

const NOTHING_SET: TenantTaxSettings = {
  invoiceLegalName: "",
  invoiceRegistrationNumber: "",
  taxRateAppliesFrom: "",
  taxRateBps: null,
  withholdingRateBps: null,
};

const renderCard = async (ui: ReactNode) => {
  render(ui);
  await screen.findByRole("button", { name: SUBMIT });
};

const field = (name: string) =>
  screen.getByRole<HTMLInputElement>("textbox", { name });

const submitButton = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: SUBMIT });

afterEach(() => {
  cleanup();
  // A submission left in flight would hold back the next test's transitions.
  save.current.resolve(null);
  save.current = Promise.withResolvers<TenantTaxSettingsActionState>();
  save.formData = undefined;
});

describe("TenantTaxSettingsForm", () => {
  it("fills each field from the saved settings and says since when the rate applies, in the tenant's zone", async () => {
    await renderCard(
      <TenantTaxSettingsForm
        canEdit
        initialSettings={SAVED}
        locale="en"
        tenantId="TENANT001"
        timeZone="Asia/Tokyo"
      />
    );

    expect(field("Tax rate (%)").value).toBe("10");
    expect(field("Withholding rate (%)").value).toBe("10.21");
    expect(field("Legal name").value).toBe("Example Publishing Inc.");
    expect(field("Registration number").value).toBe("T1234567890123");
    expect(
      screen.getByText(
        /The current rate has applied since Nov 1, 2026, 12:00 AM\./u
      )
    ).toBeDefined();
  });

  it("leaves every field empty, and names no date, for a tenant that set nothing", async () => {
    await renderCard(
      <TenantTaxSettingsForm
        canEdit
        initialSettings={NOTHING_SET}
        locale="en"
        tenantId="TENANT001"
        timeZone="Asia/Tokyo"
      />
    );

    expect(field("Tax rate (%)").value).toBe("");
    expect(field("Withholding rate (%)").value).toBe("");
    expect(
      screen.queryByText(/The current rate has applied since/u)
    ).toBeNull();
  });

  it("names no date once the rate was changed to none", async () => {
    await renderCard(
      <TenantTaxSettingsForm
        canEdit
        initialSettings={{ ...SAVED, taxRateBps: null }}
        locale="en"
        tenantId="TENANT001"
        timeZone="Asia/Tokyo"
      />
    );

    expect(field("Tax rate (%)").value).toBe("");
    expect(
      screen.queryByText(/The current rate has applied since/u)
    ).toBeNull();
  });

  it("shows the saved settings read-only to someone who is not a tenant admin", async () => {
    await renderCard(
      <TenantTaxSettingsForm
        canEdit={false}
        initialSettings={SAVED}
        locale="en"
        tenantId="TENANT001"
        timeZone="Asia/Tokyo"
      />
    );

    expect(field("Tax rate (%)").disabled).toBe(true);
    expect(field("Tax rate (%)").value).toBe("10");
    expect(field("Registration number").disabled).toBe(true);
    expect(submitButton().disabled).toBe(true);
    expect(
      screen.getByText(
        "Only a tenant administrator can change this setting. You have read-only access."
      )
    ).toBeDefined();
  });

  it("blocks editing and shows the reason when the read fails", async () => {
    await renderCard(
      <TenantTaxSettingsForm
        canEdit
        loadErrorMessage="Could not load the tax and invoice settings."
        locale="en"
        tenantId="TENANT001"
        timeZone="Asia/Tokyo"
      />
    );

    expect(field("Tax rate (%)").disabled).toBe(true);
    expect(submitButton().disabled).toBe(true);
    expect(
      screen.getByText(/Saving now would overwrite the stored settings/u)
    ).toBeDefined();
  });

  it("posts every field as typed", async () => {
    await renderCard(
      <TenantTaxSettingsForm
        canEdit
        initialSettings={NOTHING_SET}
        locale="en"
        tenantId="TENANT001"
        timeZone="Asia/Tokyo"
      />
    );

    fireEvent.change(field("Tax rate (%)"), { target: { value: "8" } });
    fireEvent.change(field("Registration number"), {
      target: { value: "T1234567890123" },
    });
    fireEvent.click(submitButton());

    await waitFor(() => {
      expect(save.formData?.get("tax_rate")).toBe("8");
    });
    expect(save.formData?.get("withholding_rate")).toBe("");
    expect(save.formData?.get("invoice_legal_name")).toBe("");
    expect(save.formData?.get("invoice_registration_number")).toBe(
      "T1234567890123"
    );
    expect(save.formData?.get("tenant_id")).toBe("TENANT001");
  });

  it("shows a refusal under the field it names", async () => {
    await renderCard(
      <TenantTaxSettingsForm
        canEdit
        initialSettings={NOTHING_SET}
        locale="en"
        tenantId="TENANT001"
        timeZone="Asia/Tokyo"
      />
    );

    fireEvent.change(field("Tax rate (%)"), { target: { value: "0" } });
    fireEvent.click(submitButton());
    save.current.resolve({
      fieldErrors: { taxRateBps: "Enter a percentage from 0.01 to 100." },
      message: "Check the highlighted fields.",
      ok: false,
    });

    expect(
      await screen.findByText("Enter a percentage from 0.01 to 100.")
    ).toBeDefined();
    expect(field("Tax rate (%)").value).toBe("0");
  });
});
