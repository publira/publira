// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import type { FormActionState } from "@publira/ui-components/action-form";
import { ToastProvider, ToastViewport } from "@publira/ui-components/toast";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";

import { RefundPurchaseButton } from "./refund-purchase-button";

const refund =
  vi.fn<
    (
      previousState: FormActionState,
      formData: FormData
    ) => Promise<FormActionState>
  >();

// The Action is `"use server"`, so the module it lives in cannot be evaluated
// here at all.
vi.mock("../_lib/actions", () => ({
  refundPurchaseAction: (previousState: FormActionState, formData: FormData) =>
    refund(previousState, formData),
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

const PURCHASE_ID = "018f0e6a-5000-7000-8000-000000000001";

const renderButton = () =>
  render(
    <AdminLocaleTestProvider locale="en">
      <ToastProvider>
        <RefundPurchaseButton purchaseId={PURCHASE_ID} tenantId="TENANT001" />
        <ToastViewport />
      </ToastProvider>
    </AdminLocaleTestProvider>
  );

const openDialog = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Refund" }));
  return within(await screen.findByRole("dialog"));
};

afterEach(() => {
  cleanup();
  refund.mockReset();
});

describe("RefundPurchaseButton", () => {
  it("cannot be confirmed until a reason is written", async () => {
    renderButton();

    const dialog = await openDialog();
    const confirm = dialog.getByRole("button", { name: "Refund" });
    expect(confirm).toHaveProperty("disabled", true);

    const reason = dialog.getByRole("textbox", { name: "Reason*" });
    fireEvent.change(reason, { target: { value: "   " } });
    expect(confirm).toHaveProperty("disabled", true);

    fireEvent.change(reason, { target: { value: "Bought twice." } });
    expect(confirm).toHaveProperty("disabled", false);
    expect(refund).not.toHaveBeenCalled();
  });

  it("posts the reason written in the dialog with the purchase", async () => {
    refund.mockResolvedValue({
      message: "The refund was requested.",
      ok: true,
    });
    renderButton();

    const dialog = await openDialog();
    fireEvent.change(dialog.getByRole("textbox", { name: "Reason*" }), {
      target: { value: "Bought twice by mistake." },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Refund" }));

    await waitFor(() => {
      expect(refund).toHaveBeenCalledTimes(1);
    });
    const [[, formData]] = refund.mock.calls;
    expect(formData.get("tenant_id")).toBe("TENANT001");
    expect(formData.get("purchase_id")).toBe(PURCHASE_ID);
    expect(formData.get("reason")).toBe("Bought twice by mistake.");
    expect(await screen.findByText("The refund was requested.")).toBeTruthy();
  });

  it("keeps the reason for another try when the refund is refused", async () => {
    refund.mockResolvedValue({
      message: "This purchase cannot be refunded.",
      ok: false,
    });
    renderButton();

    let dialog = await openDialog();
    fireEvent.change(dialog.getByRole("textbox", { name: "Reason*" }), {
      target: { value: "Asked by the reader." },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Refund" }));

    expect(
      await screen.findByText("This purchase cannot be refunded.")
    ).toBeTruthy();

    dialog = await openDialog();
    expect(dialog.getByRole("textbox", { name: "Reason*" })).toHaveProperty(
      "value",
      "Asked by the reader."
    );
  });
});
