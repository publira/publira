"use client";

import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
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
  ActionForm.useSettled((state) => {
    if (state?.ok) {
      spend?.(state.message);
    }
  });

  return null;
};

/** How many recovery codes are left, as the verify form's Action worded it. */
export const MfaRemainingRecoveryCodes = () => use(RecoveryCodeSpentContext);

/** How the verify step is being answered. */
export type MfaVerifyMethod = "code" | "passkey";

const ShowVerifyMethodContext = createContext<Dispatch<MfaVerifyMethod> | null>(
  null
);

/**
 * One way of answering the challenge at a time: `passkey` first where the
 * account holds one, since it asks nothing to be typed, and `code` otherwise.
 * Each slot carries a `MfaVerifyMethodSwitch` to the other, so neither is a
 * dead end — the code form is how a recovery code is spent, whatever the
 * account holds.
 */
export const MfaVerifyMethods = ({
  code,
  passkey,
}: {
  code: ReactNode;
  /** `null` for an account without a passkey. */
  passkey: ReactNode;
}) => {
  const [method, setMethod] = useState<MfaVerifyMethod>(
    passkey ? "passkey" : "code"
  );

  return (
    <ShowVerifyMethodContext value={setMethod}>
      {method === "passkey" ? passkey : code}
    </ShowVerifyMethodContext>
  );
};

/** Moves `MfaVerifyMethods` on to the other way of answering. */
export const MfaVerifyMethodSwitch = ({
  children,
  to,
}: {
  children: ReactNode;
  to: MfaVerifyMethod;
}) => {
  const show = use(ShowVerifyMethodContext);

  return (
    <Button
      className="justify-self-start px-0"
      onClick={() => show?.(to)}
      type="button"
      variant="link"
    >
      {children}
    </Button>
  );
};
