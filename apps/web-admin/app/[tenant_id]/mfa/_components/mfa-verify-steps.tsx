"use client";

import { useActionFormSettled } from "@publira/ui-components/action-form";
import { redirect } from "next/navigation";
import { createContext, use, useState } from "react";
import type { Dispatch, ReactNode } from "react";

const SpendRecoveryCodeContext = createContext<Dispatch<string> | null>(null);

const RecoveryCodeSpentContext = createContext("");

/**
 * The verify form until it answers, then `spent`. Only a recovery code
 * answers: a code from the authenticator finishes the login and the Action
 * redirects, so an answer means one of the ten is now spent and the operator
 * should know how many are left. A challenge spent with no answer held here
 * belongs to an earlier visit, so the login goes on to `nextPath`.
 */
export const MfaVerifySteps = ({
  finished,
  nextPath,
  spent,
  verify,
}: {
  finished: boolean;
  nextPath: string;
  spent: ReactNode;
  verify: ReactNode;
}) => {
  const [message, setMessage] = useState<string | null>(null);
  if (finished && message === null) {
    redirect(nextPath);
  }

  return message === null ? (
    <SpendRecoveryCodeContext value={setMessage}>
      {verify}
    </SpendRecoveryCodeContext>
  ) : (
    <RecoveryCodeSpentContext value={message}>{spent}</RecoveryCodeSpentContext>
  );
};

/** Moves `MfaVerifySteps` on to `spent` once the verify form succeeds. */
export const MfaRecoveryCodeSpent = () => {
  const spend = use(SpendRecoveryCodeContext);
  useActionFormSettled((state) => {
    if (state?.ok) {
      spend?.(state.message);
    }
  });

  return null;
};

/** How many recovery codes are left, as the verify form's Action worded it. */
export const MfaRemainingRecoveryCodes = () => use(RecoveryCodeSpentContext);
