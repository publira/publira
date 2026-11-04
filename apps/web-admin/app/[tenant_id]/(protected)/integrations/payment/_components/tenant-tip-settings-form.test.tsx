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

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";

import type { TenantTipSettingsFormState } from "../payment-types";
import { TenantTipSettingsForm } from "./tenant-tip-settings-form";

/** The answer the mocked Action gives, and the form it was submitted. */
interface PendingSubmission {
  current: PromiseWithResolvers<TenantTipSettingsFormState>;
  formData?: FormData;
}

const { save } = vi.hoisted(() => {
  const submission: PendingSubmission = {
    current: Promise.withResolvers<TenantTipSettingsFormState>(),
  };

  return { save: submission };
});

vi.mock("../_lib/actions", () => ({
  updateTenantTipSettingsAction: (
    _state: TenantTipSettingsFormState,
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

const renderForm = (
  props: Partial<Parameters<typeof TenantTipSettingsForm>[0]> = {}
) =>
  render(
    <AdminLocaleTestProvider locale="en">
      <TenantTipSettingsForm
        canEdit
        currency="JPY"
        initialSettings={{ amounts: [100, 300, 1000], enabled: true }}
        tenantId="TENANT001"
        {...props}
      />
    </AdminLocaleTestProvider>
  );

const tipsSwitch = () =>
  screen.getByRole("switch", { name: "Take tips for Authors" });

/** The amounts' fields, in order. */
const amountFields = () =>
  screen.getAllByRole<HTMLInputElement>("spinbutton", {
    name: /^Tip amount \d+$/u,
  });

const amountField = (position: number) =>
  screen.getByRole<HTMLInputElement>("spinbutton", {
    name: `Tip amount ${position}`,
  });

const amountValues = () => amountFields().map((field) => field.value);

const addButton = () => screen.getByRole("button", { name: "Add an amount" });

const submitButton = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: "Save tip settings" });

/** Types `value` into the field at `position` and leaves it. */
const enterAmount = (position: number, value: string) => {
  fireEvent.change(amountField(position), { target: { value } });
  fireEvent.focusOut(amountField(position));
};

afterEach(() => {
  cleanup();
  // A submission left in flight would hold back the next test's transitions.
  save.current.resolve(null);
  save.current = Promise.withResolvers<TenantTipSettingsFormState>();
  save.formData = undefined;
});

describe("TenantTipSettingsForm", () => {
  it("opens on the saved switch and one field per amount", () => {
    renderForm();

    expect(tipsSwitch().getAttribute("aria-checked")).toBe("true");
    expect(amountValues()).toEqual(["100", "300", "1000"]);
    expect(
      screen.getByText(
        "Up to 6 amounts in JPY, each above 0, offered in ascending order. Pasting several lines adds a field for each."
      )
    ).toBeTruthy();
  });

  it("shows the amounts in the major unit of a currency that has a minor one", () => {
    renderForm({
      currency: "USD",
      initialSettings: { amounts: [199, 500], enabled: false },
    });

    expect(tipsSwitch().getAttribute("aria-checked")).toBe("false");
    expect(amountValues()).toEqual(["1.99", "5.00"]);
    expect(amountField(1).step).toBe("0.01");
  });

  // A save replaces the whole list, and an amount read in no currency is no
  // amount, so the card stays closed without either.
  it.each([
    ["the settings", { initialSettings: undefined }],
    ["the currency", { currency: undefined }],
  ])("closes while %s could not be read", (_, props) => {
    renderForm({
      ...props,
      loadErrorMessage:
        "Could not load the tip settings. Please try again later.",
    });

    expect(
      screen.getByText(
        "Could not load the tip settings. Please try again later."
      )
    ).toBeTruthy();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(submitButton().disabled).toBe(true);
  });

  it("names 0 once its field is left", () => {
    renderForm();

    fireEvent.change(amountField(2), { target: { value: "0" } });
    expect(
      screen.queryByText(
        'Enter each tip amount as an amount above 0. "0" is not one.'
      )
    ).toBeNull();

    fireEvent.focusOut(amountField(2));

    expect(
      screen.getByText(
        'Enter each tip amount as an amount above 0. "0" is not one.'
      )
    ).toBeTruthy();
    expect(amountField(2).getAttribute("aria-invalid")).toBe("true");
  });

  it("names the later of two fields that hold the same amount", () => {
    renderForm();

    enterAmount(3, "100");

    expect(
      screen.getByText('"100" is entered more than once in Tip amounts.')
    ).toBeTruthy();
    expect(amountField(1).getAttribute("aria-invalid")).toBeNull();
    expect(amountField(3).getAttribute("aria-invalid")).toBe("true");
  });

  it("names a seventh amount", () => {
    renderForm({
      initialSettings: { amounts: [1, 2, 3, 4, 5, 6], enabled: true },
    });

    expect(screen.queryByText("Enter at most 6 tip amounts.")).toBeNull();

    fireEvent.click(addButton());
    enterAmount(7, "7");

    expect(screen.getByText("Enter at most 6 tip amounts.")).toBeTruthy();
  });

  it("submits the switch, the amounts, and the currency they were typed in", async () => {
    renderForm({ initialSettings: { amounts: [], enabled: false } });

    fireEvent.click(tipsSwitch());
    enterAmount(1, "1000");
    fireEvent.click(addButton());
    enterAmount(2, "100");
    fireEvent.click(submitButton());

    await waitFor(() => {
      expect(save.formData).toBeDefined();
    });
    expect(save.formData?.get("tips_enabled")).toBe("on");
    expect(save.formData?.getAll("tip_amounts")).toEqual(["1000", "100"]);
    expect(save.formData?.get("tip_amounts_currency")).toBe("JPY");
  });

  it("puts a refusal of the amounts under the list", async () => {
    renderForm();

    fireEvent.click(submitButton());
    save.current.resolve({
      fieldErrors: {
        tipAmounts: "Enter at least one tip amount to take tips.",
      },
      message: "Please check the information you entered.",
      ok: false,
    });

    expect(
      await screen.findByText("Enter at least one tip amount to take tips.")
    ).toBeTruthy();
  });
});
