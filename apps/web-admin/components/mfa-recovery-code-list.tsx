"use client";

import { createContext, use } from "react";

/**
 * The batch of recovery codes a submission just returned, handed by the
 * component holding that result to the `MfaRecoveryCodes` placed below it.
 */
export const IssuedMfaRecoveryCodes = createContext<readonly string[]>([]);

export const MfaRecoveryCodeList = () => {
  const codes = use(IssuedMfaRecoveryCodes);

  return (
    <ul className="grid grid-cols-2 gap-2">
      {codes.map((code) => (
        <li key={code}>
          {/*
            A recovery code is transcribed character by character, so it is
            set in the monospace face that tells `1` from `l` and `0` from `O`
            apart — the one place a console still wants one.
          */}
          <code className="font-mono text-sm tracking-wider">{code}</code>
        </li>
      ))}
    </ul>
  );
};
