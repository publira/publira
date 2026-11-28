"use client";

import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import type { ButtonProps } from "@publira/ui-components/button";
import * as ConfirmDialog from "@publira/ui-components/confirm-dialog";
import { createContext, useContext, useId } from "react";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

const DangerConfirmFormContext = createContext<string | null>(null);

const useDangerConfirmForm = (): string => {
  const formId = useContext(DangerConfirmFormContext);

  if (!formId) {
    throw new Error(
      "DangerConfirmButton slots must be rendered inside a DangerConfirmButton."
    );
  }

  return formId;
};

interface DangerConfirmButtonProps {
  action: ActionForm.RootProps["action"];
  /**
   * The hidden inputs `action` reads, a `DangerConfirmButton.Trigger`, and the
   * `ConfirmDialog.Content` it opens, with a `DangerConfirmButton.Action` in
   * its footer.
   */
  children: ReactNode;
}

/**
 * A form that submits to `action` once the operator confirms in a dialog, and
 * shows the refusal `action` answers with under the button. Success shows
 * nothing: the page it re-renders says what changed.
 *
 * ```tsx
 * <DangerConfirmButton.Root action={…}>
 *   <input name="…" type="hidden" value={…} />
 *   <DangerConfirmButton.Trigger>…</DangerConfirmButton.Trigger>
 *   <ConfirmDialog.Content>
 *     <ConfirmDialog.Header>
 *       <ConfirmDialog.Title>…</ConfirmDialog.Title>
 *       <ConfirmDialog.Description>…</ConfirmDialog.Description>
 *     </ConfirmDialog.Header>
 *     <ConfirmDialog.Footer>
 *       <ConfirmDialog.Cancel>…</ConfirmDialog.Cancel>
 *       <DangerConfirmButton.Action>…</DangerConfirmButton.Action>
 *     </ConfirmDialog.Footer>
 *   </ConfirmDialog.Content>
 * </DangerConfirmButton.Root>
 * ```
 */
const DangerConfirmButton = ({
  action,
  children,
}: DangerConfirmButtonProps) => {
  const formId = useId();

  return (
    <DangerConfirmFormContext value={formId}>
      <ActionForm.Root
        action={action}
        className="grid max-w-sm justify-items-end gap-2"
        id={formId}
        showSuccess={false}
      >
        <ConfirmDialog.Root>{children}</ConfirmDialog.Root>
      </ActionForm.Root>
    </DangerConfirmFormContext>
  );
};

/** The button that opens the dialog, disabled while the action runs. */
const DangerConfirmButtonTrigger = ({
  children,
  variant = "destructive",
}: {
  children: ReactNode;
  variant?: ButtonProps["variant"];
}) => {
  const { pending } = useFormStatus();

  return (
    <ConfirmDialog.Trigger
      render={
        <Button disabled={pending} type="button" variant={variant}>
          {children}
        </Button>
      }
    />
  );
};

/**
 * The dialog's confirm control, which submits the form. The dialog portals
 * out of the form, so the form's id is what connects the two.
 */
const DangerConfirmButtonAction = ({
  children,
  variant = "destructiveFilled",
}: {
  children: ReactNode;
  variant?: NonNullable<ButtonProps["variant"]>;
}) => {
  const formId = useDangerConfirmForm();

  return (
    <ConfirmDialog.Action form={formId} variant={variant}>
      {children}
    </ConfirmDialog.Action>
  );
};

export {
  DangerConfirmButton as Root,
  DangerConfirmButtonAction as Action,
  DangerConfirmButtonTrigger as Trigger,
};
