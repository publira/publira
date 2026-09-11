"use client";

import {
  AuthScreenBody,
  AuthScreenFooter,
  AuthScreenNote,
} from "@publira/layouts/auth-screen";
import { Button, LinkButton } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import Link from "next/link";
import { Suspense, useActionState } from "react";

import { ClientMessage } from "#components/client-message";
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
 * An enrollment that signed the operator in goes on to the console; one that
 * did not sends them back to the password step. Each ending names itself.
 */
const MfaEnrollDoneLabel = ({ signedIn }: { signedIn: boolean }) =>
  signedIn ? (
    <ClientMessage message="admin.auth.mfa.continue_to_console" />
  ) : (
    <ClientMessage message="admin.auth.mfa.back_to_login" />
  );

const MfaEnrollConfirmLabel = ({ isPending }: { isPending: boolean }) =>
  isPending ? (
    <ClientMessage message="admin.auth.mfa.enroll_confirm_submitting" />
  ) : (
    <ClientMessage message="admin.auth.mfa.enroll_confirm_submit" />
  );

const MfaEnrollStartLabel = ({ isPending }: { isPending: boolean }) =>
  isPending ? (
    <ClientMessage message="admin.auth.mfa.enroll_starting" />
  ) : (
    <ClientMessage message="admin.auth.mfa.enroll_start" />
  );

/**
 * The enrollment a tenant requires of an administrator before it will finish
 * their login: start, scan, confirm, and keep the recovery codes.
 *
 * Starting is a submission rather than something the page does while it
 * renders, because it mints and stores a secret.
 */
export const MfaEnrollFlow = ({ nextPath, tenantId }: MfaEnrollFlowProps) => {
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
      <AuthScreenBody>
        <MfaRecoveryCodes codes={confirmState.recoveryCodes} />
        <LinkButton
          className="justify-self-start"
          render={<Link href={confirmState.signedIn ? nextPath : "/login"} />}
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <MfaEnrollDoneLabel signedIn={confirmState.signedIn} />
          </Suspense>
        </LinkButton>
      </AuthScreenBody>
    );
  }

  if (startState?.ok) {
    return (
      <AuthScreenBody>
        <MfaEnrollmentSecret qr={startState.qr} secret={startState.secret} />

        <form action={confirmAction} className="grid gap-4">
          <input name="tenant_id" type="hidden" value={tenantId} />

          <MfaCodeField allowRecoveryCode={false} disabled={isConfirming} />

          {confirmState && !confirmState.ok ? (
            <FormMessage variant="destructive">
              {confirmState.message}
            </FormMessage>
          ) : null}

          <Button
            className="justify-self-start"
            disabled={isConfirming}
            type="submit"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <MfaEnrollConfirmLabel isPending={isConfirming} />
            </Suspense>
          </Button>
        </form>
      </AuthScreenBody>
    );
  }

  return (
    <>
      <AuthScreenBody>
        <h2 className="font-medium text-foreground">
          <Suspense fallback={<SkeletonLine className="h-5 w-56" />}>
            <ClientMessage message="admin.auth.mfa.enroll_required_title" />
          </Suspense>
        </h2>
        <AuthScreenNote>
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <ClientMessage message="admin.auth.mfa.enroll_required_description" />
          </Suspense>
        </AuthScreenNote>

        <form action={startAction} className="grid gap-4">
          <input name="tenant_id" type="hidden" value={tenantId} />

          {startState && !startState.ok ? (
            <FormMessage variant="destructive">
              {startState.message}
            </FormMessage>
          ) : null}

          <Button
            className="justify-self-start"
            disabled={isStarting}
            type="submit"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <MfaEnrollStartLabel isPending={isStarting} />
            </Suspense>
          </Button>
        </form>
      </AuthScreenBody>

      <AuthScreenFooter>
        <p>
          <Link
            className="text-primary underline underline-offset-4"
            href="/login"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <ClientMessage message="admin.auth.mfa.back_to_login" />
            </Suspense>
          </Link>
        </p>
      </AuthScreenFooter>
    </>
  );
};
