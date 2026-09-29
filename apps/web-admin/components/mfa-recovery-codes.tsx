"use client";

import { useClientMessages } from "./client-message";

interface MfaRecoveryCodesProps {
  codes: string[];
}

/**
 * The batch of recovery codes, at the one moment they exist in plaintext.
 *
 * Every screen that can produce them says the same thing about them, so the
 * heading and the warning are resolved here rather than passed in.
 */
export const MfaRecoveryCodes = ({ codes }: MfaRecoveryCodesProps) => {
  const t = useClientMessages();

  return (
    <div className="grid gap-3 border border-border bg-muted/40 p-4">
      <div className="grid gap-1">
        <p className="text-sm font-medium text-foreground">
          {t("admin.auth.mfa.recovery_codes_title")}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("admin.auth.mfa.recovery_codes_description")}
        </p>
      </div>
      <ul className="grid grid-cols-2 gap-2">
        {codes.map((code) => (
          <li key={code}>
            {/*
              A recovery code is transcribed character by character, so it is
              set in the monospace face that tells `1` from `l` and `0` from
              `O` apart — the one place a console still wants one.
            */}
            <code className="font-mono text-sm tracking-wider">{code}</code>
          </li>
        ))}
      </ul>
    </div>
  );
};
