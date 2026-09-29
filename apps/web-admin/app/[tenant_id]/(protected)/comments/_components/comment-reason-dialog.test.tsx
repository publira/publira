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

import { CommentReasonDialog } from "./comment-reason-dialog";

const hide =
  vi.fn<
    (
      previousState: FormActionState,
      formData: FormData
    ) => Promise<FormActionState>
  >();

// The Actions are `"use server"`, so the module they live in cannot be
// evaluated here at all.
vi.mock("../_lib/actions", () => ({
  hideCommentAction: (previousState: FormActionState, formData: FormData) =>
    hide(previousState, formData),
  purgeCommentAction: vi.fn(),
}));

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"))(message, values),
}));

// The field resolves its placeholder on the server; here it only has to join
// the form the way the real one does.
vi.mock("./comment-reason-input", async () => {
  const { Textarea } = await import("@publira/ui-components/textarea");

  return {
    CommentReasonInput: ({ formId }: { formId: string }) => (
      <Textarea form={formId} name="reason" />
    ),
  };
});

/**
 * Two rows of the list, since every row submits to the same Action and the
 * answer belongs under the one that was pressed.
 */
const renderRows = () =>
  render(
    <ToastProvider>
      <ul>
        <li data-testid="COMMENT001">
          <CommentReasonDialog
            action="hide"
            commentId="COMMENT001"
            tenantId="TENANT001"
          />
        </li>
        <li data-testid="COMMENT002">
          <CommentReasonDialog
            action="hide"
            commentId="COMMENT002"
            tenantId="TENANT001"
          />
        </li>
      </ul>
      <ToastViewport />
    </ToastProvider>
  );

/** Opens the first row's dialog, writes `reason`, and confirms it. */
const removeWithReason = async (reason: string) => {
  fireEvent.click(
    within(screen.getByTestId("COMMENT001")).getByRole("button", {
      name: "Remove",
    })
  );
  const dialog = within(await screen.findByRole("dialog"));
  fireEvent.change(
    await dialog.findByRole("textbox", { name: "Reason (optional)" }),
    { target: { value: reason } }
  );
  fireEvent.click(dialog.getByRole("button", { name: "Remove" }));

  await waitFor(() => {
    expect(hide).toHaveBeenCalledTimes(1);
  });
};

afterEach(() => {
  cleanup();
  hide.mockReset();
});

describe("CommentReasonDialog", () => {
  // The reason field sits in the dialog's portal, outside the form's DOM, and
  // joins it through `form=`.
  it("posts the reason written in the dialog with the row's comment", async () => {
    hide.mockResolvedValue({ message: "The comment was removed.", ok: true });
    renderRows();

    await removeWithReason("Personal information in the text");

    const [[, formData]] = hide.mock.calls;
    expect(formData.get("comment_id")).toBe("COMMENT001");
    expect(formData.get("reason")).toBe("Personal information in the text");
    expect(formData.get("tenant_id")).toBe("TENANT001");
  });

  // The row changes state once the comment is removed, so the success is
  // announced away from it.
  it("announces a removal in a toast", async () => {
    hide.mockResolvedValue({ message: "The comment was removed.", ok: true });
    renderRows();

    await removeWithReason("Spam");

    expect(await screen.findByText("The comment was removed.")).toBeDefined();
    expect(
      within(screen.getByTestId("COMMENT001")).queryByText(
        "The comment was removed."
      )
    ).toBeNull();
  });

  it("shows a refusal under the row that was pressed only", async () => {
    hide.mockResolvedValue({
      message: "This comment can no longer be removed.",
      ok: false,
    });
    renderRows();

    await removeWithReason("Spam");

    expect(
      await within(screen.getByTestId("COMMENT001")).findByText(
        "This comment can no longer be removed."
      )
    ).toBeDefined();
    expect(
      within(screen.getByTestId("COMMENT002")).queryByText(
        "This comment can no longer be removed."
      )
    ).toBeNull();
  });
});
