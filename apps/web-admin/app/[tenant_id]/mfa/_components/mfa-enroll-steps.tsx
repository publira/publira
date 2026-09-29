"use client";

import { useActionFormSettled } from "@publira/ui-components/action-form";
import { LinkButton } from "@publira/ui-components/button";
import Link from "next/link";
import { createContext, use, useState } from "react";
import type { Dispatch, ReactNode } from "react";

import { IssuedMfaRecoveryCodes } from "#components/mfa-recovery-code-list";
import type { MfaEnrollmentConfirmState } from "#lib/mfa-action-state";

interface ConfirmedMfaEnrollment {
  recoveryCodes: string[];
  signedIn: boolean;
}

const ConfirmMfaEnrollmentContext =
  createContext<Dispatch<ConfirmedMfaEnrollment> | null>(null);

const SignedInContext = createContext(false);

/**
 * The enrollment until its confirm form succeeds, then `done`. That answer
 * replaces the confirm form along with everything around it, so it is held
 * here rather than in the form.
 */
export const MfaEnrollSteps = ({
  done,
  enroll,
}: {
  done: ReactNode;
  enroll: ReactNode;
}) => {
  const [confirmed, setConfirmed] = useState<ConfirmedMfaEnrollment | null>(
    null
  );

  return confirmed ? (
    <SignedInContext value={confirmed.signedIn}>
      <IssuedMfaRecoveryCodes value={confirmed.recoveryCodes}>
        {done}
      </IssuedMfaRecoveryCodes>
    </SignedInContext>
  ) : (
    <ConfirmMfaEnrollmentContext value={setConfirmed}>
      {enroll}
    </ConfirmMfaEnrollmentContext>
  );
};

/** Moves `MfaEnrollSteps` on to `done` once the confirm form succeeds. */
export const MfaEnrollmentConfirmed = () => {
  const confirm = use(ConfirmMfaEnrollmentContext);
  useActionFormSettled<NonNullable<MfaEnrollmentConfirmState>>((state) => {
    if (state?.ok) {
      confirm?.({
        recoveryCodes: state.recoveryCodes,
        signedIn: state.signedIn,
      });
    }
  });

  return null;
};

/**
 * An enrollment that signed the operator in goes on to the console; one that
 * did not sends them back to the password step. Each ending names itself.
 */
export const MfaEnrollDoneLink = ({
  nextPath,
  signedIn,
  signedOut,
}: {
  nextPath: string;
  signedIn: ReactNode;
  signedOut: ReactNode;
}) => {
  const isSignedIn = use(SignedInContext);

  return (
    <LinkButton
      className="justify-self-start"
      render={<Link href={isSignedIn ? nextPath : "/login"} />}
    >
      {isSignedIn ? signedIn : signedOut}
    </LinkButton>
  );
};
