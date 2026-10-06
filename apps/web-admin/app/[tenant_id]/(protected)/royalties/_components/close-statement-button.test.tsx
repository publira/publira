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
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CloseRoyaltyStatementActionState } from "../royalty-types";
import { CloseStatementButton } from "./close-statement-button";

const close =
  vi.fn<
    (
      previousState: CloseRoyaltyStatementActionState,
      formData: FormData
    ) => Promise<CloseRoyaltyStatementActionState>
  >();

// The Action is `"use server"`, so its module cannot be evaluated here. What
// the button owns is asking first, posting the month, and reporting a refusal.
vi.mock("../_lib/actions", () => ({
  closeRoyaltyStatementAction: (
    previousState: CloseRoyaltyStatementActionState,
    formData: FormData
  ) => close(previousState, formData),
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

const renderButton = async () => {
  await act(() => {
    render(
      <CloseStatementButton
        confirmDescription="The payout to authors, ¥2,500 in total, will be fixed in a statement."
        confirmTitle="Close August 2026?"
        period="2026-08"
        tenantId="TENANT001"
      />
    );
  });
  await screen.findByRole("button", { name: "Close month" });
};

/** The trigger and the confirmation share a label, so the dialog scopes. */
const openConfirmation = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Close month" }));

  const dialog = within(await screen.findByRole("alertdialog"));
  await dialog.findByRole("button", { name: "Close month" });

  return dialog;
};

afterEach(() => {
  cleanup();
  close.mockReset();
});

describe("CloseStatementButton", () => {
  it("names the month and its total payout before closing anything", async () => {
    await renderButton();
    const dialog = await openConfirmation();

    expect(dialog.getByText("Close August 2026?")).toBeDefined();
    expect(
      dialog.getByText(
        "The payout to authors, ¥2,500 in total, will be fixed in a statement."
      )
    ).toBeDefined();
    expect(close).not.toHaveBeenCalled();
  });

  it("leaves the month open when the confirmation is dismissed", async () => {
    await renderButton();
    const dialog = await openConfirmation();

    fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));

    expect(close).not.toHaveBeenCalled();
  });

  it("posts the month once it is confirmed", async () => {
    close.mockResolvedValue(null);

    await renderButton();
    const dialog = await openConfirmation();
    fireEvent.click(dialog.getByRole("button", { name: "Close month" }));

    await waitFor(() => {
      expect(close).toHaveBeenCalledTimes(1);
    });
    const [[, formData]] = close.mock.calls;
    expect(formData.get("period")).toBe("2026-08");
    expect(formData.get("tenant_id")).toBe("TENANT001");
  });

  it("cannot be pressed again while the close is in flight", async () => {
    // React entangles pending async actions across roots, so the close is
    // settled before the test ends rather than left running into the next.
    const { promise, resolve } =
      Promise.withResolvers<CloseRoyaltyStatementActionState>();
    close.mockReturnValue(promise);

    await renderButton();
    const dialog = await openConfirmation();
    fireEvent.click(dialog.getByRole("button", { name: "Close month" }));

    const pending = await screen.findByRole("button", { name: "Closing…" });
    expect(pending.matches(":disabled")).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);

    await act(() => {
      resolve(null);
    });
  });

  it("shows why the API refused a second close of the same month", async () => {
    close.mockResolvedValue({
      message: "This month is already closed.",
      ok: false,
    });

    await renderButton();
    const dialog = await openConfirmation();
    fireEvent.click(dialog.getByRole("button", { name: "Close month" }));

    expect(
      await screen.findByText("This month is already closed.")
    ).toBeDefined();
  });
});
