// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import type * as ActionForm from "@publira/ui-components/action-form";
import * as Toast from "@publira/ui-components/toast";
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

import type { RefundAmountBounds } from "./refund-draft";
import { RefundPurchaseButton } from "./refund-purchase-button";

const refund =
  vi.fn<
    (
      previousState: ActionForm.State,
      formData: FormData
    ) => Promise<ActionForm.State>
  >();

// The Action is `"use server"`, so the module it lives in cannot be evaluated
// here at all.
vi.mock("../_lib/actions", () => ({
  refundPurchaseAction: (previousState: ActionForm.State, formData: FormData) =>
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

const renderButton = (bounds: RefundAmountBounds | null = null) =>
  render(
    <AdminLocaleTestProvider locale="en">
      <Toast.Provider>
        <RefundPurchaseButton
          bounds={bounds}
          locale="en"
          purchaseId={PURCHASE_ID}
          tenantId="TENANT001"
        />
        <Toast.Viewport />
      </Toast.Provider>
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

  it("asks for no amount where only all that is left can be refunded", async () => {
    renderButton();

    const dialog = await openDialog();

    expect(dialog.queryByRole("spinbutton")).toBeNull();
  });

  it("starts at all that is left, and says the purchase then closes", async () => {
    renderButton({ currency: "JPY", left: 300, requested: 0 });

    const dialog = await openDialog();

    const amount = dialog.getByRole("spinbutton", {
      name: "Amount to refund*",
    });

    expect(amount).toHaveProperty("value", "300");
    expect(
      dialog.getByText(/Up to ¥300, all that is left to refund\./u)
    ).toBeTruthy();
    expect(
      dialog.getByText(
        /That is all that is left, so what the reader bought closes to them at once\./u
      )
    ).toBeTruthy();
  });

  it("posts an amount below what is left, saying the purchase stays open", async () => {
    refund.mockResolvedValue({
      message: "A refund of ¥120 was requested.",
      ok: true,
    });
    renderButton({ currency: "JPY", left: 300, requested: 0 });

    const dialog = await openDialog();
    fireEvent.change(
      dialog.getByRole("spinbutton", { name: "Amount to refund*" }),
      { target: { value: "120" } }
    );
    expect(
      dialog.getByText(/What the reader bought stays open to them\./u)
    ).toBeTruthy();
    fireEvent.change(dialog.getByRole("textbox", { name: "Reason*" }), {
      target: { value: "Half of the pages would not load." },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Refund" }));

    await waitFor(() => {
      expect(refund).toHaveBeenCalledTimes(1);
    });
    const [[, formData]] = refund.mock.calls;
    expect(formData.get("amount")).toBe("120");
    expect(formData.get("currency")).toBe("JPY");
    expect(formData.get("left")).toBe("300");
    expect(
      await screen.findByText("A refund of ¥120 was requested.")
    ).toBeTruthy();
  });

  it.each([
    ["zero", "0"],
    ["more than is left", "301"],
    ["a fraction of a yen", "1.5"],
  ])("cannot be confirmed for %s", async (_label, value) => {
    renderButton({ currency: "JPY", left: 300, requested: 0 });

    const dialog = await openDialog();
    fireEvent.change(dialog.getByRole("textbox", { name: "Reason*" }), {
      target: { value: "Asked by the reader." },
    });
    fireEvent.change(
      dialog.getByRole("spinbutton", { name: "Amount to refund*" }),
      { target: { value } }
    );

    expect(dialog.getByRole("button", { name: "Refund" })).toHaveProperty(
      "disabled",
      true
    );
    expect(
      dialog.getByText(
        /Enter an amount above zero and no more than what is left to refund\./u
      )
    ).toBeTruthy();
  });

  it("asks again only for the refund in part waiting for the provider", async () => {
    renderButton({ currency: "JPY", left: 300, requested: 120 });

    const dialog = await openDialog();

    const amount = dialog.getByRole("spinbutton", {
      name: "Amount to refund*",
    });

    expect(amount).toHaveProperty("value", "120");
    expect(amount).toHaveProperty("readOnly", true);
    expect(
      dialog.getByText(
        /A refund of ¥120 is waiting for the payment provider\./u
      )
    ).toBeTruthy();
  });
});
