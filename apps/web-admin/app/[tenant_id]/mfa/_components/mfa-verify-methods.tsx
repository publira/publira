"use client";

import { Button } from "@publira/ui-components/button";
import { createContext, use, useState } from "react";
import type { Dispatch, ReactNode } from "react";

/** How the verify step is being answered. */
type MfaVerifyMethod = "code" | "passkey";

const ShowVerifyMethodContext = createContext<Dispatch<MfaVerifyMethod> | null>(
  null
);

/**
 * One way of answering the challenge at a time: `passkey` first where the
 * account holds one, since it asks nothing to be typed, and `code` otherwise.
 * Each slot carries a `MfaVerifyMethodsSwitch` to the other, so neither is a
 * dead end — the code form is how a recovery code is spent, whatever the
 * account holds.
 */
const MfaVerifyMethods = ({
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
const MfaVerifyMethodsSwitch = ({
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

export { MfaVerifyMethods as Root, MfaVerifyMethodsSwitch as Switch };

export type { MfaVerifyMethod as Method };
