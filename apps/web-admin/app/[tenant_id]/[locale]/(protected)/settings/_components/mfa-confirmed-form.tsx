"use client";

import * as ActionForm from "@publira/ui-components/action-form";
import type { ReactNode } from "react";

import { usePasskeyConfirmation } from "#components/passkey-ceremony";
import type {
  PasskeyConfirmedAction,
  PasskeyFailure,
} from "#components/passkey-ceremony";

import { beginAccountPasskeyConfirmationAction } from "../_lib/mfa-actions";

/**
 * A form whose Action changes the account's second factors, so that an
 * `MfaConfirmationField` among its children left empty is answered by one of
 * the account's passkeys before the Action runs.
 */
export const MfaConfirmedForm = <State extends ActionForm.Result | null>({
  action,
  children,
  className,
  id,
}: {
  action: PasskeyConfirmedAction<State>;
  children: ReactNode;
  className?: string;
  id?: string;
}) => {
  const confirmed = usePasskeyConfirmation<State>(
    beginAccountPasskeyConfirmationAction,
    action
  );

  return (
    <ActionForm.Root<NonNullable<State> | PasskeyFailure>
      action={confirmed}
      className={className}
      id={id}
      showSuccess={false}
    >
      {children}
    </ActionForm.Root>
  );
};
