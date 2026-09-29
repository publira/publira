// @vitest-environment jsdom

import type { FormActionState } from "@publira/ui-components/action-form";
import { ToastProvider } from "@publira/ui-components/toast";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";

import { InvitationCancelButton } from "./invitation-cancel-button";

const cancel =
  vi.fn<
    (
      previousState: FormActionState,
      formData: FormData
    ) => Promise<FormActionState>
  >();

vi.mock("../_lib/actions", () => ({
  cancelTenantAdminInvitationAction: (
    previousState: FormActionState,
    formData: FormData
  ) => cancel(previousState, formData),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ tenant_id: "TENANT001" }),
}));

const EnglishConsole = ({ children }: { children: ReactNode }) => (
  <AdminLocaleTestProvider locale="en">
    <ToastProvider>{children}</ToastProvider>
  </AdminLocaleTestProvider>
);

const renderButton = async () => {
  await act(() => {
    render(
      <InvitationCancelButton
        email="invitee@example.com"
        invitationId="INVITATION001"
      />,
      { wrapper: EnglishConsole }
    );
  });
  await screen.findByRole("button", { name: "Cancel invitation" });
};

const openConfirmation = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Cancel invitation" }));
  return within(await screen.findByRole("alertdialog"));
};

afterEach(() => {
  cleanup();
  cancel.mockReset();
});

describe("InvitationCancelButton", () => {
  it("names the address whose link stops working", async () => {
    await renderButton();
    const dialog = await openConfirmation();

    expect(
      dialog.getByText(
        "The link mailed to invitee@example.com stops working and can no longer be accepted."
      )
    ).toBeDefined();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("leaves the invitation alone when the confirmation is dismissed", async () => {
    await renderButton();
    const dialog = await openConfirmation();

    fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));

    expect(cancel).not.toHaveBeenCalled();
  });

  it("posts the invitation and shows a refusal", async () => {
    cancel.mockResolvedValue({
      message: "This invitation can no longer be canceled.",
      ok: false,
    });

    await renderButton();
    const dialog = await openConfirmation();
    fireEvent.click(dialog.getByRole("button", { name: "Cancel invitation" }));

    await waitFor(() => {
      expect(cancel).toHaveBeenCalledTimes(1);
    });
    const [[, formData]] = cancel.mock.calls;
    expect(formData.get("invitation_id")).toBe("INVITATION001");
    expect(formData.get("tenant_id")).toBe("TENANT001");
    expect(
      await screen.findByText("This invitation can no longer be canceled.")
    ).toBeDefined();
  });
});
