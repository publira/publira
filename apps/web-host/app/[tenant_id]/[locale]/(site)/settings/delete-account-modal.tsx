"use client";

import { useCallback, useState } from "react";

import { ClientMessage } from "#components/client-message";
import { LocaleField } from "#components/locale-field";
import { useTenantId } from "#lib/use-tenant-id";

interface DeleteAccountModalProps {
  deleteAction: (formData: FormData) => Promise<void>;
}

export const DeleteAccountModal = ({
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
        <ClientMessage message="host.settings.delete_open" />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <dialog
            aria-labelledby="delete-account-modal-title"
            className="relative m-0 w-full max-w-md rounded-surface border border-border bg-card p-6 shadow-floating open:flex open:flex-col"
            open
          >
            <h3
              className="text-lg font-semibold text-destructive"
              id="delete-account-modal-title"
            >
              <ClientMessage message="host.settings.delete_confirm_title" />
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              <ClientMessage message="host.settings.delete_confirm_description" />
            </p>

            <form action={deleteAction} className="mt-5 space-y-4">
              <LocaleField />
              <input name="tenantId" type="hidden" value={tenantId} />

              <div className="space-y-2">
                <label htmlFor="deletePassword" className="text-sm font-medium">
                  <ClientMessage message="host.settings.current_password_label" />
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
                  <ClientMessage message="host.settings.cancel" />
                </button>
                <button
                  className="inline-flex rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:opacity-90"
                  type="submit"
                >
                  <ClientMessage message="host.settings.delete_submit" />
                </button>
              </div>
            </form>
          </dialog>
        </div>
      ) : null}
    </>
  );
};
