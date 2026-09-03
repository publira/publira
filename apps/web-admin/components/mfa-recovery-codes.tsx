"use client";

import { getMessage } from "@publira/i18n";

import { useAdminMessages } from "./admin-locale-context";

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
  const messages = useAdminMessages();

  return (
    <div className="grid gap-3 rounded-lg border border-border/70 bg-muted/40 p-4">
      <div className="grid gap-1">
        <p className="text-sm font-medium text-foreground">
          {getMessage(messages, "admin.auth.mfa.recovery_codes_title")}
        </p>
        <p className="text-xs text-muted-foreground">
          {getMessage(messages, "admin.auth.mfa.recovery_codes_description")}
        </p>
      </div>
      <ul className="grid grid-cols-2 gap-2">
        {codes.map((code) => (
          <li className="font-mono text-sm tracking-wider" key={code}>
            {code}
          </li>
        ))}
      </ul>
    </div>
  );
};
