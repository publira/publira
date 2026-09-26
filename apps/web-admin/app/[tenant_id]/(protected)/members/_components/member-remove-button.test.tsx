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

import { MemberRemoveButton } from "./member-remove-button";

const remove =
  vi.fn<
    (
      previousState: FormActionState,
      formData: FormData
    ) => Promise<FormActionState>
  >();

vi.mock("../_lib/actions", () => ({
  removeTenantMemberAction: (
    previousState: FormActionState,
    formData: FormData
  ) => remove(previousState, formData),
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
    render(<MemberRemoveButton name="Riley Editor" userPublicId="USER001" />, {
      wrapper: EnglishConsole,
    });
  });
  await screen.findByRole("button", { name: "Remove" });
};

const confirmRemove = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  const dialog = within(await screen.findByRole("alertdialog"));
  fireEvent.click(await dialog.findByRole("button", { name: "Remove" }));

  await waitFor(() => {
    expect(remove).toHaveBeenCalledTimes(1);
  });
};

afterEach(() => {
  cleanup();
  remove.mockReset();
});

describe("MemberRemoveButton", () => {
  it("asks before it removes the member", async () => {
    await renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    const dialog = within(await screen.findByRole("alertdialog"));
    expect(dialog.getByText("Remove this member?")).toBeDefined();
    expect(
      dialog.getByText(
        "Riley Editor loses every role in this console. Their account stays as a reader of this tenant."
      )
    ).toBeDefined();
    expect(remove).not.toHaveBeenCalled();
  });

  it("posts the member the row stands for", async () => {
    remove.mockResolvedValue({ message: "Member removed.", ok: true });

    await renderButton();
    await confirmRemove();

    const [[, formData]] = remove.mock.calls;
    expect(formData.get("user_public_id")).toBe("USER001");
    expect(formData.get("tenant_id")).toBe("TENANT001");
  });

  // The last admin is the one member the API refuses to remove, and the row
  // that is still on screen is the only place that can say why.
  it("shows the refusal next to the row", async () => {
    const refusal =
      "This member is the tenant's last tenant admin. Make someone else a tenant admin before removing them.";
    remove.mockResolvedValue({ message: refusal, ok: false });

    await renderButton();
    await confirmRemove();

    expect(await screen.findByText(refusal)).toBeDefined();
  });
});
