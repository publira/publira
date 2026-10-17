"use client";

import { ActionForm } from "@publira/ui-components/action-form";
import type { ReactNode } from "react";

import {
  authenticatePasskey,
  usePasskeyCeremony,
} from "#components/passkey-ceremony";
import type { MfaRecoveryCodesState } from "#lib/mfa-action-state";

import {
  beginAccountPasskeyConfirmationAction,
  regenerateAccountMfaRecoveryCodesWithPasskeyAction,
} from "../_lib/mfa-actions";

/**
 * Replaces the recovery codes once one of the account's passkeys has
 * answered, for an account with no authenticator app to give a code. The new
 * batch comes back in the answer, which `ReportMfaSettingsChange` among the
 * children hands to the card.
 */
export const PasskeyRegenerateForm = ({
  children,
}: {
  children: ReactNode;
}) => {
  const regenerate = usePasskeyCeremony<MfaRecoveryCodesState>(
    beginAccountPasskeyConfirmationAction,
    authenticatePasskey,
    regenerateAccountMfaRecoveryCodesWithPasskeyAction
  );

  return (
    <ActionForm action={regenerate} className="grid gap-3" showSuccess={false}>
      {children}
    </ActionForm>
  );
};
