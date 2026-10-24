"use client";

import * as PasswordInput from "@publira/ui-components/password-input";
import { cn } from "@publira/utils";
import { useCallback, useState } from "react";

import { ClientMessage } from "#components/client-message";
import { LocaleField } from "#components/locale-field";
import { startSocialSignInAction } from "#lib/social-sign-in-actions";
import { useTenantId } from "#lib/use-tenant-id";

import * as PasskeyConfirmation from "./_components/passkey-confirmation";
import { deleteAccountWithPasskeyAction } from "./_lib/actions";
import { beginPasskeyConfirmationAction } from "./_lib/passkey-confirmation-actions";

interface DeleteAccountModalProps {
  /** Whether the site can send the reader to Apple to confirm. */
  canConfirmWithApple: boolean;
  canConfirmWithGoogle: boolean;
  /** Whether the account holds a passkey to confirm with. */
  canConfirmWithPasskey: boolean;
  deleteAction: (formData: FormData) => Promise<void>;
  /**
   * False for an account a provider sign-in created, which confirms with a
   * passkey or a fresh sign-in to a linked provider instead of a password.
   */
  hasPassword: boolean;
}

const confirmButtonClassName = cn(
  "inline-flex w-full justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
);

const ProviderConfirmFields = ({
  provider,
  tenantId,
}: {
  provider: string;
  tenantId: string;
}) => (
  <>
    <LocaleField />
    <input name="tenantId" type="hidden" value={tenantId} />
    <input name="intent" type="hidden" value="delete" />
    <input name="provider" type="hidden" value={provider} />
    <input name="returnTo" type="hidden" value="/settings" />
  </>
);

export const DeleteAccountModal = ({
  canConfirmWithApple,
  canConfirmWithGoogle,
  canConfirmWithPasskey,
  deleteAction,
  hasPassword,
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
        <ClientMessage message="storefront.settings.delete_open" />
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
              <ClientMessage message="storefront.settings.delete_confirm_title" />
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {hasPassword ? (
                <ClientMessage message="storefront.settings.delete_confirm_description" />
              ) : null}
              {!hasPassword && canConfirmWithPasskey ? (
                <ClientMessage message="storefront.settings.delete_confirm_with_passkey" />
              ) : null}
              {hasPassword || canConfirmWithPasskey ? null : (
                <ClientMessage message="storefront.settings.delete_confirm_with_provider" />
              )}
            </p>

            {hasPassword ? (
              <form action={deleteAction} className="mt-5 space-y-4">
                <LocaleField />
                <input name="tenantId" type="hidden" value={tenantId} />

                <div className="space-y-2">
                  <label
                    htmlFor="deletePassword"
                    className="text-sm font-medium"
                  >
                    <ClientMessage message="storefront.settings.current_password_label" />
                  </label>
                  <PasswordInput.Root>
                    <PasswordInput.Control
                      autoComplete="current-password"
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                      id="deletePassword"
                      name="password"
                      placeholder="********"
                      required
                    />
                    <PasswordInput.Toggle>
                      <ClientMessage message="storefront.common.show_password" />
                    </PasswordInput.Toggle>
                  </PasswordInput.Root>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    className="inline-flex rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
                    onClick={closeModal}
                    type="button"
                  >
                    <ClientMessage message="storefront.settings.cancel" />
                  </button>
                  <button
                    className="inline-flex rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:opacity-90"
                    type="submit"
                  >
                    <ClientMessage message="storefront.settings.delete_submit" />
                  </button>
                </div>
              </form>
            ) : (
              <div className="mt-5 space-y-3">
                {canConfirmWithPasskey ? (
                  <form className="space-y-3">
                    <LocaleField />
                    <input name="tenantId" type="hidden" value={tenantId} />
                    <input name="returnTo" type="hidden" value="/settings" />
                    <PasskeyConfirmation.Root
                      begin={beginPasskeyConfirmationAction}
                      confirm={deleteAccountWithPasskeyAction}
                    >
                      <PasskeyConfirmation.Submit
                        className={confirmButtonClassName}
                      >
                        <ClientMessage message="storefront.settings.delete_with_passkey" />
                      </PasskeyConfirmation.Submit>
                      <PasskeyConfirmation.Message />
                    </PasskeyConfirmation.Root>
                  </form>
                ) : null}
                {canConfirmWithApple ? (
                  <form action={startSocialSignInAction}>
                    <ProviderConfirmFields
                      provider="apple"
                      tenantId={tenantId}
                    />
                    <button className={confirmButtonClassName} type="submit">
                      <ClientMessage message="storefront.settings.delete_with_apple" />
                    </button>
                  </form>
                ) : null}
                {canConfirmWithGoogle ? (
                  <form action={startSocialSignInAction}>
                    <ProviderConfirmFields
                      provider="google"
                      tenantId={tenantId}
                    />
                    <button className={confirmButtonClassName} type="submit">
                      <ClientMessage message="storefront.settings.delete_with_google" />
                    </button>
                  </form>
                ) : null}
                {canConfirmWithApple ||
                canConfirmWithGoogle ||
                canConfirmWithPasskey ? null : (
                  <p className="text-sm text-muted-foreground">
                    <ClientMessage message="storefront.settings.delete_no_provider" />
                  </p>
                )}
                <div className="flex justify-end pt-2">
                  <button
                    className="inline-flex rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
                    onClick={closeModal}
                    type="button"
                  >
                    <ClientMessage message="storefront.settings.cancel" />
                  </button>
                </div>
              </div>
            )}
          </dialog>
        </div>
      ) : null}
    </>
  );
};
