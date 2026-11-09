"use client";

import * as ActionForm from "@publira/ui-components/action-form";
import * as Dialog from "@publira/ui-components/dialog";
import { Input } from "@publira/ui-components/input";
import { createContext, use, useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";

interface DeleteTenantDialogState {
  /** The tenant's saved name, which `typed` has to equal. */
  name: string;
  setOpen: (open: boolean) => void;
  setTyped: (typed: string) => void;
  typed: string;
}

const DeleteTenantDialogContext = createContext<DeleteTenantDialogState | null>(
  null
);

const useDeleteTenantDialog = (): DeleteTenantDialogState => {
  const state = use(DeleteTenantDialogContext);

  if (!state) {
    throw new Error(
      "DeleteTenantDialog parts must be rendered inside a DeleteTenantDialog.Root."
    );
  }

  return state;
};

/**
 * The dialog a tenant is deleted from, which holds what the operator has typed
 * into its name field. Closing it forgets that, so reopening it asks for the
 * name again.
 */
const DeleteTenantDialog = ({
  children,
  name,
}: {
  children: ReactNode;
  name: string;
}) => {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);

    if (!next) {
      setTyped("");
    }
  }, []);

  const state = useMemo<DeleteTenantDialogState>(
    () => ({ name, setOpen: handleOpenChange, setTyped, typed }),
    [handleOpenChange, name, typed]
  );

  return (
    <DeleteTenantDialogContext value={state}>
      <Dialog.Root onOpenChange={handleOpenChange} open={open}>
        {children}
      </Dialog.Root>
    </DeleteTenantDialogContext>
  );
};

/** The field the operator types the tenant's name into. */
const DeleteTenantDialogNameInput = () => {
  const { setTyped, typed } = useDeleteTenantDialog();

  return (
    <Input
      autoComplete="off"
      name="tenant_name_confirmation"
      onValueChange={setTyped}
      required
      spellCheck={false}
      type="text"
      value={typed}
    />
  );
};

/**
 * The control that deletes the tenant, closed until the field holds the
 * tenant's name exactly. The server compares the two again, so this only
 * saves the operator a request that would be refused.
 */
const DeleteTenantDialogSubmit = ({ children }: { children: ReactNode }) => {
  const { name, typed } = useDeleteTenantDialog();

  return (
    <ActionForm.Submit disabled={typed !== name} variant="destructiveFilled">
      {children}
    </ActionForm.Submit>
  );
};

/**
 * Closes the dialog once the tenant is marked for deletion: the page behind
 * it says so from then on.
 */
const DeleteTenantDialogCloseOnSuccess = () => {
  const { setOpen } = useDeleteTenantDialog();
  ActionForm.useSettled((state) => {
    if (state?.ok) {
      setOpen(false);
    }
  });

  return null;
};

export {
  DeleteTenantDialog as Root,
  DeleteTenantDialogCloseOnSuccess as CloseOnSuccess,
  DeleteTenantDialogNameInput as NameInput,
  DeleteTenantDialogSubmit as Submit,
};
