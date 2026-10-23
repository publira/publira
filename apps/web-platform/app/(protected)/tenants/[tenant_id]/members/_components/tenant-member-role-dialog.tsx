"use client";

import * as ActionForm from "@publira/ui-components/action-form";
import * as Dialog from "@publira/ui-components/dialog";
import { createContext, use, useState } from "react";
import type { ReactNode } from "react";

const SetRoleDialogOpenContext = createContext<
  ((open: boolean) => void) | null
>(null);

/** The dialog a member's role is changed in; its form closes it on success. */
export const TenantMemberRoleDialog = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [open, setOpen] = useState(false);

  return (
    <SetRoleDialogOpenContext value={setOpen}>
      <Dialog.Root onOpenChange={setOpen} open={open}>
        {children}
      </Dialog.Root>
    </SetRoleDialogOpenContext>
  );
};

/**
 * Closes the surrounding `TenantMemberRoleDialog` once the form it sits in
 * saves the role: the form has nothing left to show.
 */
export const CloseTenantMemberRoleDialogOnSuccess = () => {
  const setOpen = use(SetRoleDialogOpenContext);
  ActionForm.useSettled((state) => {
    if (state?.ok) {
      setOpen?.(false);
    }
  });

  return null;
};
