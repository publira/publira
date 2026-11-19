"use client";

import * as ActionForm from "@publira/ui-components/action-form";
import type { ReactNode } from "react";

import {
  authenticatePasskey,
  registerPasskey,
  usePasskeyCeremony,
} from "#components/passkey-ceremony";
import type {
  MfaEnrollmentConfirmState,
  MfaVerifyState,
} from "#lib/mfa-action-state";

import {
  beginPasskeyRegistrationAction,
  beginPasskeyVerificationAction,
  finishPasskeyRegistrationAction,
  finishPasskeyVerificationAction,
} from "../_lib/actions";

/**
 * Answers the verify challenge with one of the account's passkeys. Success
 * leaves `/mfa` from the Action, so the form only ever shows a failure.
 */
export const PasskeyVerifyForm = ({ children }: { children: ReactNode }) => {
  const verify = usePasskeyCeremony<MfaVerifyState>(
    beginPasskeyVerificationAction,
    authenticatePasskey,
    finishPasskeyVerificationAction
  );

  return (
    <ActionForm.Root action={verify} className="grid gap-4" showSuccess={false}>
      {children}
    </ActionForm.Root>
  );
};

/**
 * Enrolls a passkey in place of the authenticator app. Its success is the
 * same answer confirming an authenticator gives, so `MfaEnrollSteps.Confirmed`
 * among the children moves the flow on to the recovery codes.
 */
export const PasskeyEnrollForm = ({ children }: { children: ReactNode }) => {
  const enroll = usePasskeyCeremony<MfaEnrollmentConfirmState>(
    beginPasskeyRegistrationAction,
    registerPasskey,
    finishPasskeyRegistrationAction
  );

  return (
    <ActionForm.Root action={enroll} className="grid gap-4" showSuccess={false}>
      {children}
    </ActionForm.Root>
  );
};
