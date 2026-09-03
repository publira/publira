"use client";

import { getMessage } from "@publira/i18n";
import { Button, LinkButton } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import Link from "next/link";
import { useActionState } from "react";

import { useAdminMessages } from "#components/admin-locale-context";
import { MfaCodeField } from "#components/mfa-code-field";
import { MfaEnrollmentSecret } from "#components/mfa-enrollment-secret";
import { MfaRecoveryCodes } from "#components/mfa-recovery-codes";

import {
  confirmMfaEnrollmentAction,
  startMfaEnrollmentAction,
} from "../_lib/actions";

interface MfaEnrollFlowProps {
  /** Where the login was heading before the tenant held it for an enrollment. */
  nextPath: string;
  tenantId: string;
}

/**
 * The enrollment a tenant requires of an administrator before it will finish
 * their login: start, scan, confirm, and keep the recovery codes.
 *
 * Starting is a submission rather than something the page does while it
 * renders, because it mints and stores a secret.
 */
export const MfaEnrollFlow = ({ nextPath, tenantId }: MfaEnrollFlowProps) => {
  const messages = useAdminMessages();
  const [startState, startAction, isStarting] = useActionState(
    startMfaEnrollmentAction,
    null
  );
  const [confirmState, confirmAction, isConfirming] = useActionState(
    confirmMfaEnrollmentAction,
    null
  );

  if (confirmState?.ok) {
    return (
      <div className="space-y-5 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
        <MfaRecoveryCodes codes={confirmState.recoveryCodes} />
        <LinkButton
          className="w-full"
          render={<Link href={confirmState.signedIn ? nextPath : "/login"} />}
        >
          {getMessage(
            messages,
            confirmState.signedIn
              ? "admin.auth.mfa.continue_to_console"
              : "admin.auth.mfa.back_to_login"
          )}
        </LinkButton>
      </div>
    );
  }

  if (startState?.ok) {
    return (
      <div className="space-y-5 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
        <MfaEnrollmentSecret qr={startState.qr} secret={startState.secret} />

        <form action={confirmAction} className="space-y-4">
          <input name="tenant_id" type="hidden" value={tenantId} />

          <MfaCodeField allowRecoveryCode={false} disabled={isConfirming} />

          {confirmState && !confirmState.ok ? (
            <FormMessage variant="destructive">
              {confirmState.message}
            </FormMessage>
          ) : null}

          <Button className="mt-2 w-full" disabled={isConfirming} type="submit">
            {getMessage(
              messages,
              isConfirming
                ? "admin.auth.mfa.enroll_confirm_submitting"
                : "admin.auth.mfa.enroll_confirm_submit"
            )}
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-5 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
      <h2 className="font-medium text-foreground">
        {getMessage(messages, "admin.auth.mfa.enroll_required_title")}
      </h2>
      <p className="text-sm text-muted-foreground">
        {getMessage(messages, "admin.auth.mfa.enroll_required_description")}
      </p>

      <form action={startAction} className="space-y-4">
        <input name="tenant_id" type="hidden" value={tenantId} />

        {startState && !startState.ok ? (
          <FormMessage variant="destructive">{startState.message}</FormMessage>
        ) : null}

        <Button className="w-full" disabled={isStarting} type="submit">
          {getMessage(
            messages,
            isStarting
              ? "admin.auth.mfa.enroll_starting"
              : "admin.auth.mfa.enroll_start"
          )}
        </Button>
      </form>

      <div className="text-center text-sm">
        <Link
          className="font-medium text-primary hover:underline"
          href="/login"
        >
          {getMessage(messages, "admin.auth.mfa.back_to_login")}
        </Link>
      </div>
    </div>
  );
};
