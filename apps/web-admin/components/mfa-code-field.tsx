"use client";

import { getMessage } from "@publira/i18n";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";

import { useAdminMessages } from "./admin-locale-context";

interface MfaCodeFieldProps {
  /**
   * Whether one of the account's recovery codes is accepted here too. The API
   * takes one where the point is proving the account, and refuses one where
   * the point is proving the authenticator — confirming an enrollment, or
   * minting a new batch of codes.
   */
  allowRecoveryCode: boolean;
  disabled?: boolean;
}

/**
 * The one input every second-factor form has.
 *
 * It reads the same on all of them, so it resolves its own copy rather than
 * making four call sites pass the same label and hint.
 */
export const MfaCodeField = ({
  allowRecoveryCode,
  disabled,
}: MfaCodeFieldProps) => {
  const messages = useAdminMessages();

  return (
    <Field>
      <FieldLabel required>
        {getMessage(messages, "admin.auth.mfa.code_label")}
      </FieldLabel>
      <FieldContent>
        <Input
          autoComplete="one-time-code"
          disabled={disabled}
          // A recovery code carries letters and a separator, so the numeric
          // keypad is only right where the authenticator is the only source.
          inputMode={allowRecoveryCode ? "text" : "numeric"}
          name="code"
          placeholder={getMessage(messages, "admin.auth.mfa.code_placeholder")}
          required
          type="text"
        />
        <FieldDescription>
          {getMessage(
            messages,
            allowRecoveryCode
              ? "admin.auth.mfa.code_help"
              : "admin.auth.mfa.code_help_totp_only"
          )}
        </FieldDescription>
      </FieldContent>
    </Field>
  );
};
