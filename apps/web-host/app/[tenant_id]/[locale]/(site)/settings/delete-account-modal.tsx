"use client";

import { useCallback, useState } from "react";

import { LocaleField } from "#components/locale-field";
import { useTenantId } from "#lib/use-tenant-id";

/**
 * Resolved strings rather than nodes: the dialog is mounted from a click
 * handler, so nothing in it can stream in from the server.
 */
interface DeleteAccountModalCopy {
  cancel: string;
  confirmDescription: string;
  confirmTitle: string;
  open: string;
  passwordLabel: string;
  submit: string;
}

interface DeleteAccountModalProps {
  copy: DeleteAccountModalCopy;
  deleteAction: (formData: FormData) => Promise<void>;
}

export const DeleteAccountModal = ({
  copy,
  deleteAction,
}: DeleteAccountModalProps) => {
  const tenantId = useTenantId();
  const [open, setOpen] = useState(false);
  const openModal = useCallback(() => setOpen(true), []);
  const closeModal = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        className="inline-flex rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:opacity-90"
        onClick={openModal}
        type="button"
      >
        {copy.open}
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <dialog
            aria-labelledby="delete-account-modal-title"
            className="relative m-0 w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl open:flex open:flex-col"
            open
          >
            <h3
              className="text-lg font-semibold text-destructive"
              id="delete-account-modal-title"
            >
              {copy.confirmTitle}
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {copy.confirmDescription}
            </p>

            <form action={deleteAction} className="mt-5 space-y-4">
              <LocaleField />
              <input name="tenantId" type="hidden" value={tenantId} />

              <div className="space-y-2">
                <label htmlFor="deletePassword" className="text-sm font-medium">
                  {copy.passwordLabel}
                </label>
                <input
                  autoComplete="current-password"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  id="deletePassword"
                  name="password"
                  placeholder="********"
                  required
                  type="password"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  className="inline-flex rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
                  onClick={closeModal}
                  type="button"
                >
                  {copy.cancel}
                </button>
                <button
                  className="inline-flex rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:opacity-90"
                  type="submit"
                >
                  {copy.submit}
                </button>
              </div>
            </form>
          </dialog>
        </div>
      ) : null}
    </>
  );
};
